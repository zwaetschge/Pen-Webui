#!/usr/bin/env python3
"""Local Chromecast sender for Plum Tabletop.

The service listens on a Unix socket shared with the Next.js container. Its
host-network access exists only so Zeroconf can discover Cast devices on the
home LAN; no TCP port is published.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler
import json
import logging
import os
from pathlib import Path
import re
import signal
from socketserver import ThreadingMixIn, UnixStreamServer
import threading
import time
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlsplit

import pychromecast
from pychromecast.controllers.dashcast import DashCastController
from pychromecast.discovery import CastBrowser, SimpleCastListener
from zeroconf import Zeroconf


LOG = logging.getLogger("plum-cast-agent")
MAX_BODY_BYTES = 16 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


class AgentError(Exception):
    code = "cast_agent_error"
    status = 500


class CastNotFound(AgentError):
    code = "device_not_found"
    status = 404


class CastConflict(AgentError):
    code = "device_busy"
    status = 409


@dataclass(frozen=True)
class DiscoveredDevice:
    id: str
    name: str
    model: str
    host: str
    cast_info: object


@dataclass
class ActiveCast:
    session_id: str
    device: DiscoveredDevice
    cast: Any
    controller: Any
    url: str
    started_at: float


def derive_auth_token(secret: str) -> str:
    digest = hashlib.sha256()
    digest.update(b"plum-cast-agent:v1\0")
    digest.update(secret.encode("utf-8"))
    return digest.hexdigest()


def validate_cast_url(url: str, allowed_origin: str, session_id: str) -> str:
    if not IDENTIFIER.fullmatch(session_id):
        raise ValueError("invalid_session")
    if not isinstance(url, str) or len(url) > 4096:
        raise ValueError("invalid_url")

    parsed = urlsplit(url)
    allowed = urlsplit(allowed_origin)
    if (
        parsed.scheme not in ("http", "https")
        or parsed.scheme != allowed.scheme
        or parsed.netloc != allowed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("invalid_url")

    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if (
        len(parts) != 4
        or parts[0] != "display"
        or parts[1] != "sessions"
        or parts[2] != session_id
        or not parts[3]
        or len(parts[3]) > 2048
    ):
        raise ValueError("invalid_url")
    return url


class DiscoveryRegistry:
    def __init__(self, known_hosts: list[str] | None = None) -> None:
        self.zeroconf = Zeroconf()
        listener = SimpleCastListener(
            lambda _uuid, _service: None,
            lambda _uuid, _service, _info: None,
            lambda _uuid, _service: None,
        )
        self.browser = CastBrowser(listener, self.zeroconf, known_hosts)
        self.browser.start_discovery()

    def devices(self) -> list[DiscoveredDevice]:
        records: list[DiscoveredDevice] = []
        for cast_info in list(self.browser.devices.values()):
            if cast_info.cast_type not in (None, "cast"):
                continue
            records.append(
                DiscoveredDevice(
                    id=str(cast_info.uuid),
                    name=cast_info.friendly_name or "Chromecast",
                    model=cast_info.model_name or "Google Cast",
                    host=cast_info.host,
                    cast_info=cast_info,
                )
            )
        return sorted(records, key=lambda device: device.name.casefold())

    def connect(self, device: DiscoveredDevice):
        return pychromecast.get_chromecast_from_cast_info(
            device.cast_info,
            self.browser.zc,
            tries=2,
            retry_wait=1,
            timeout=10,
        )

    def close(self) -> None:
        self.browser.stop_discovery()


class CastService:
    def __init__(
        self,
        discovery: Any,
        allowed_origin: str,
        controller_factory: Callable[[], Any] = DashCastController,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.discovery = discovery
        self.allowed_origin = allowed_origin.rstrip("/")
        self.controller_factory = controller_factory
        self.clock = clock
        self._active: dict[str, ActiveCast] = {}
        self._lock = threading.RLock()

    def list_devices(self) -> list[dict[str, object]]:
        with self._lock:
            active_sessions = {
                device_id: active.session_id
                for device_id, active in self._active.items()
            }
        return [
            {
                "id": device.id,
                "name": device.name,
                "model": device.model,
                "online": True,
                "activeSessionId": active_sessions.get(device.id),
            }
            for device in self.discovery.devices()
        ]

    def start_cast(
        self,
        session_id: str,
        device_id: str,
        url: str,
    ) -> dict[str, object]:
        self._validate_identifier(device_id, "invalid_device")
        validated_url = validate_cast_url(
            url, self.allowed_origin, session_id
        )
        device = self._find_device(device_id)

        with self._lock:
            existing = self._active.get(device_id)
            if existing and existing.session_id != session_id:
                raise CastConflict()
            if existing:
                existing.controller.load_url(validated_url, force=True)
                existing.url = validated_url
                existing.started_at = self.clock()
                return self._cast_payload("starting", existing)

            cast = self.discovery.connect(device)
            controller = self.controller_factory()
            try:
                cast.wait(timeout=10)
                cast.register_handler(controller)
                controller.load_url(validated_url, force=True)
            except Exception:
                try:
                    cast.disconnect()
                except Exception:
                    pass
                raise

            active = ActiveCast(
                session_id=session_id,
                device=device,
                cast=cast,
                controller=controller,
                url=validated_url,
                started_at=self.clock(),
            )
            self._active[device_id] = active
            return self._cast_payload("starting", active)

    def stop_cast(self, session_id: str, device_id: str) -> dict[str, object]:
        self._validate_identifier(session_id, "invalid_session")
        self._validate_identifier(device_id, "invalid_device")
        device = self._find_device(device_id)
        with self._lock:
            active = self._active.get(device_id)
            if active and active.session_id != session_id:
                raise CastConflict()
            if active:
                try:
                    active.cast.quit_app()
                finally:
                    try:
                        active.cast.disconnect()
                    finally:
                        self._active.pop(device_id, None)
            return {
                "state": "stopped",
                "deviceId": device.id,
                "deviceName": device.name,
                "sessionId": session_id,
            }

    def close(self) -> None:
        with self._lock:
            active = list(self._active.values())
            self._active.clear()
        for cast in active:
            try:
                cast.cast.disconnect()
            except Exception:
                pass

    def _find_device(self, device_id: str) -> DiscoveredDevice:
        for device in self.discovery.devices():
            if device.id == device_id:
                return device
        raise CastNotFound()

    @staticmethod
    def _validate_identifier(value: str, code: str) -> None:
        if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
            raise ValueError(code)

    @staticmethod
    def _cast_payload(state: str, active: ActiveCast) -> dict[str, object]:
        return {
            "state": state,
            "deviceId": active.device.id,
            "deviceName": active.device.name,
            "sessionId": active.session_id,
            "startedAt": active.started_at,
        }


class AgentHTTPServer(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        socket_path: str,
        service: CastService,
        auth_token: str,
    ) -> None:
        self.socket_path = socket_path
        self.service = service
        self.auth_token = auth_token
        path = Path(socket_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.unlink(missing_ok=True)
        super().__init__(socket_path, AgentRequestHandler)
        os.chmod(socket_path, 0o666)

    def server_close(self) -> None:
        super().server_close()
        Path(self.socket_path).unlink(missing_ok=True)


class AgentRequestHandler(BaseHTTPRequestHandler):
    server: AgentHTTPServer
    server_version = "PlumCastAgent/1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/v1/health":
            self._json(200, {"ok": True})
            return
        if not self._authenticated():
            return
        if self.path == "/v1/devices":
            self._run(lambda: {"devices": self.server.service.list_devices()})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authenticated():
            return
        if self.path != "/v1/casts":
            self._json(404, {"error": "not_found"})
            return

        def start() -> dict[str, object]:
            body = self._body()
            return {
                "cast": self.server.service.start_cast(
                    session_id=self._string(body, "sessionId"),
                    device_id=self._string(body, "deviceId"),
                    url=self._string(body, "url"),
                )
            }

        self._run(start, success_status=202)

    def do_DELETE(self) -> None:  # noqa: N802
        if not self._authenticated():
            return
        parsed = urlsplit(self.path)
        prefix = "/v1/casts/"
        if not parsed.path.startswith(prefix):
            self._json(404, {"error": "not_found"})
            return
        device_id = unquote(parsed.path[len(prefix) :])
        session_values = parse_qs(parsed.query).get("sessionId", [])
        if len(session_values) != 1:
            self._json(400, {"error": "invalid_request"})
            return
        session_id = session_values[0]
        self._run(
            lambda: {
                "cast": self.server.service.stop_cast(session_id, device_id)
            }
        )

    def _authenticated(self) -> bool:
        expected = f"Bearer {self.server.auth_token}"
        received = self.headers.get("authorization", "")
        if not hmac.compare_digest(received, expected):
            self._json(401, {"error": "unauthorized"})
            return False
        return True

    def _body(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError as error:
            raise ValueError("invalid_request") from error
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("invalid_request")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid_request")
        return value

    @staticmethod
    def _string(body: dict[str, object], key: str) -> str:
        value = body.get(key)
        if not isinstance(value, str):
            raise ValueError("invalid_request")
        return value

    def _run(
        self,
        operation: Callable[[], dict[str, object]],
        success_status: int = 200,
    ) -> None:
        try:
            self._json(success_status, operation())
        except AgentError as error:
            self._json(error.status, {"error": error.code})
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "invalid_request"})
        except Exception:
            LOG.exception("Cast operation failed")
            self._json(502, {"error": "cast_failed"})

    def _json(self, status: int, body: dict[str, object]) -> None:
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: object) -> None:
        LOG.debug(fmt, *args)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    secret = os.environ.get("CAST_AGENT_SECRET", "")
    allowed_origin = os.environ.get("CAST_ALLOWED_ORIGIN", "").rstrip("/")
    socket_path = os.environ.get(
        "CAST_AGENT_SOCKET", "/run/plum-cast/agent.sock"
    )
    if len(secret) < 16:
        raise SystemExit("CAST_AGENT_SECRET must contain at least 16 characters")
    allowed = urlsplit(allowed_origin)
    if allowed.scheme not in ("http", "https") or not allowed.netloc:
        raise SystemExit("CAST_ALLOWED_ORIGIN must be an absolute HTTP(S) origin")

    known_hosts = [
        host.strip()
        for host in os.environ.get("CHROMECAST_HOSTS", "").split(",")
        if host.strip()
    ]
    discovery = DiscoveryRegistry(known_hosts or None)
    service = CastService(discovery, allowed_origin)
    server = AgentHTTPServer(socket_path, service, derive_auth_token(secret))

    def request_shutdown(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    LOG.info("Cast agent ready on Unix socket %s", socket_path)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        service.close()
        discovery.close()


if __name__ == "__main__":
    main()
