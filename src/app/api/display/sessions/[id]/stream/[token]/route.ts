import {
  isDisplayCapabilityActive,
  resolveActiveDisplayCapability,
} from "@/lib/cast/display-capability";
import type { DisplayTokenClaims } from "@/lib/cast/display-token";
import { env } from "@/lib/env";
import { handleReadonlySessionStream } from "@/lib/game/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string; token: string }>;
};

const CAPABILITY_RECHECK_MS = 5_000;

export async function GET(request: Request, { params }: Context) {
  const { id, token } = await params;
  const claims = await resolveActiveDisplayCapability(
    token,
    id,
    env().INVITE_HMAC_SECRET,
  );
  if (!claims) {
    return new Response("forbidden", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const guard = createStreamGuard(request, claims);
  try {
    const response = await handleReadonlySessionStream(guard.request, id);
    return guardedResponse(response, guard.stop);
  } catch (error) {
    guard.stop();
    throw error;
  }
}

function createStreamGuard(request: Request, claims: DisplayTokenClaims) {
  const controller = new AbortController();
  let stopped = false;
  let checking = false;
  let recheck: ReturnType<typeof setInterval> | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (recheck) clearInterval(recheck);
    if (expiry) clearTimeout(expiry);
    request.signal.removeEventListener("abort", stop);
    controller.abort();
  };

  request.signal.addEventListener("abort", stop, { once: true });
  expiry = setTimeout(stop, Math.max(0, claims.expiryUnix * 1000 - Date.now()));
  expiry.unref?.();
  recheck = setInterval(() => {
    if (stopped || checking) return;
    checking = true;
    void isDisplayCapabilityActive(claims)
      .then((active) => {
        if (!active) stop();
      })
      .catch(stop)
      .finally(() => {
        checking = false;
      });
  }, CAPABILITY_RECHECK_MS);
  recheck.unref?.();

  return {
    request: new Request(request, { signal: controller.signal }),
    stop,
  };
}

function guardedResponse(response: Response, stop: () => void) {
  if (!response.body) {
    stop();
    return response;
  }

  const relay = new TransformStream<Uint8Array, Uint8Array>();
  void response.body
    .pipeTo(relay.writable)
    .catch(() => undefined)
    .finally(stop);
  return new Response(relay.readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
