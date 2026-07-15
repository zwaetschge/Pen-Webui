import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock

from server import (
    CastConflict,
    AgentHTTPServer,
    CastNotFound,
    CastService,
    DiscoveredDevice,
    derive_auth_token,
    validate_cast_url,
)


class FakeDiscovery:
    def __init__(self):
        self.device = DiscoveredDevice(
            id="cast-a",
            name="Wohnzimmer",
            model="Chromecast",
            host="192.168.1.50",
            cast_info=object(),
        )
        self.cast = Mock()
        self.cast.wait = Mock()
        self.cast.register_handler = Mock()
        self.cast.quit_app = Mock()
        self.cast.disconnect = Mock()

    def devices(self):
        return [self.device]

    def connect(self, device):
        if device.id != self.device.id:
            raise AssertionError("unexpected device")
        return self.cast


class CastAgentTests(unittest.TestCase):
    def test_auth_token_is_domain_separated(self):
        secret = "secret-with-at-least-sixteen-characters"
        token = derive_auth_token(secret)

        self.assertEqual(len(token), 64)
        self.assertNotIn(secret, token)

    def test_url_must_match_origin_display_path_and_session(self):
        valid = (
            "https://table.example/display/sessions/session-a/signed-token"
        )
        self.assertEqual(
            validate_cast_url(valid, "https://table.example", "session-a"),
            valid,
        )

        invalid = [
            "https://attacker.example/display/sessions/session-a/token",
            "http://table.example/display/sessions/session-a/token",
            "https://table.example/table/sessions/session-a",
            "https://table.example/display/sessions/session-b/token",
            "https://table.example/display/sessions/session-a/token?next=evil",
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_cast_url(value, "https://table.example", "session-a")

    def test_start_list_and_stop_cast(self):
        discovery = FakeDiscovery()
        controller = Mock()
        controller_factory = Mock(return_value=controller)
        service = CastService(
            discovery=discovery,
            allowed_origin="https://table.example",
            controller_factory=controller_factory,
            clock=lambda: 1234.0,
        )

        started = service.start_cast(
            session_id="session-a",
            device_id="cast-a",
            url="https://table.example/display/sessions/session-a/token",
        )

        self.assertEqual(started["state"], "starting")
        discovery.cast.wait.assert_called_once()
        discovery.cast.register_handler.assert_called_once_with(controller)
        controller.load_url.assert_called_once_with(
            "https://table.example/display/sessions/session-a/token",
            force=True,
        )
        self.assertEqual(
            service.list_devices()[0]["activeSessionId"], "session-a"
        )

        stopped = service.stop_cast("session-a", "cast-a")
        self.assertEqual(stopped["state"], "stopped")
        discovery.cast.quit_app.assert_called_once()
        discovery.cast.disconnect.assert_called_once()

    def test_unknown_and_busy_devices_fail_closed(self):
        discovery = FakeDiscovery()
        service = CastService(
            discovery=discovery,
            allowed_origin="https://table.example",
            controller_factory=Mock(return_value=Mock()),
            clock=time.time,
        )

        with self.assertRaises(CastNotFound):
            service.start_cast(
                "session-a",
                "missing",
                "https://table.example/display/sessions/session-a/token",
            )

        controller = Mock()
        controller.load_url = Mock()
        service.controller_factory = Mock(return_value=controller)
        service.start_cast(
            "session-a",
            "cast-a",
            "https://table.example/display/sessions/session-a/token",
        )
        with self.assertRaises(CastConflict):
            service.start_cast(
                "session-b",
                "cast-a",
                "https://table.example/display/sessions/session-b/token",
            )

    def test_unix_http_health_and_authenticated_device_list(self):
        discovery = FakeDiscovery()
        service = CastService(
            discovery=discovery,
            allowed_origin="https://table.example",
        )
        auth_token = "a" * 64

        with tempfile.TemporaryDirectory() as directory:
            socket_path = f"{directory}/agent.sock"
            server = AgentHTTPServer(socket_path, service, auth_token)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                health = unix_request(
                    socket_path,
                    b"GET /v1/health HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n",
                )
                self.assertIn(b"200 OK", health)
                self.assertIn(b'\"ok\":true', health)

                unauthorized = unix_request(
                    socket_path,
                    b"GET /v1/devices HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n",
                )
                self.assertIn(b"401 Unauthorized", unauthorized)

                devices = unix_request(
                    socket_path,
                    (
                        "GET /v1/devices HTTP/1.1\r\n"
                        "Host: local\r\n"
                        f"Authorization: Bearer {auth_token}\r\n"
                        "Connection: close\r\n\r\n"
                    ).encode("ascii"),
                )
                self.assertIn(b"200 OK", devices)
                self.assertIn(b'\"name\":\"Wohnzimmer\"', devices)
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()


def unix_request(socket_path, request):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(2)
    try:
        client.connect(socket_path)
        client.sendall(request)
        return b"".join(iter(lambda: client.recv(4096), b""))
    finally:
        client.close()


if __name__ == "__main__":
    unittest.main()
