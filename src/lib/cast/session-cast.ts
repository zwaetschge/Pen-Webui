import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import {
  activateDisplayCapability,
  revokeDisplayCapability,
} from "./display-capability";
import { buildDisplayToken, type DisplayTokenClaims } from "./display-token";
import {
  CastAgentError,
  createCastAgentClient,
  type CastAgentDevice,
} from "./agent-client";

const DISPLAY_TOKEN_TTL_SECONDS = 16 * 60 * 60;

export class CastSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "CastSessionError";
  }
}

export async function castStateForHost(sessionId: string, hostId: string) {
  await requireHostSession(sessionId, hostId, { allowEnded: true });
  const devices = await withAgent((client) => client.listDevices());
  return {
    enabled: true,
    devices: devices.map((device) => publicDevice(device, sessionId)),
  };
}

export async function startCastForHost(
  sessionId: string,
  hostId: string,
  deviceId: string,
) {
  await requireHostSession(sessionId, hostId);
  const config = env();
  const expiryUnix = Math.floor(Date.now() / 1000) + DISPLAY_TOKEN_TTL_SECONDS;
  const claims = {
    version: 2,
    audience: "plum-display",
    sessionId,
    capabilityId: randomUUID(),
    expiryUnix,
  } satisfies DisplayTokenClaims;
  const token = buildDisplayToken(
    { sessionId, capabilityId: claims.capabilityId, expiryUnix },
    config.INVITE_HMAC_SECRET,
  );
  const displayUrl = new URL(
    `/display/sessions/${encodeURIComponent(sessionId)}/${encodeURIComponent(token)}`,
    config.APP_URL,
  ).toString();

  await withCapabilityStore(() => activateDisplayCapability(claims));

  let cast;
  try {
    cast = await withAgent((client) =>
      client.startCast({ sessionId, deviceId, url: displayUrl }),
    );
  } catch (error) {
    try {
      await revokeDisplayCapability(sessionId, claims.capabilityId);
    } catch (revokeError) {
      throw new CastSessionError("display_capability_unavailable", 503, {
        cause: new AggregateError([error, revokeError]),
      });
    }
    throw error;
  }
  return {
    state: cast.state,
    deviceId: cast.deviceId,
    deviceName: cast.deviceName ?? "Chromecast",
  };
}

export async function stopCastForHost(
  sessionId: string,
  hostId: string,
  deviceId: string,
) {
  await requireHostSession(sessionId, hostId, { allowEnded: true });
  let revokeError: unknown;
  try {
    await revokeDisplayCapability(sessionId);
  } catch (error) {
    revokeError = error;
  }

  let cast;
  try {
    cast = await withAgent((client) =>
      client.stopCast({ sessionId, deviceId }),
    );
  } catch (error) {
    if (revokeError) {
      throw new CastSessionError("display_capability_unavailable", 503, {
        cause: new AggregateError([revokeError, error]),
      });
    }
    throw error;
  }
  if (revokeError) {
    throw new CastSessionError("display_capability_unavailable", 503, {
      cause: revokeError,
    });
  }
  return { state: cast.state, deviceId: cast.deviceId };
}

async function requireHostSession(
  sessionId: string,
  hostId: string,
  opts?: { allowEnded?: boolean },
) {
  const session = await prisma.gameSession.findFirst({
    where: { id: sessionId, campaign: { hostId } },
    select: { id: true, endedAt: true },
  });
  if (!session) throw new CastSessionError("not_found", 404);
  if (session.endedAt && !opts?.allowEnded) {
    throw new CastSessionError("session_closed", 410);
  }
  return session;
}

function castClient() {
  const config = env();
  return createCastAgentClient({
    socketPath: config.CAST_AGENT_SOCKET,
    secret: config.INVITE_HMAC_SECRET,
  });
}

async function withAgent<T>(
  run: (client: ReturnType<typeof castClient>) => Promise<T>,
) {
  try {
    return await run(castClient());
  } catch (error) {
    if (error instanceof CastSessionError) throw error;
    if (error instanceof CastAgentError) {
      if (error.status === 404) {
        throw new CastSessionError("device_not_found", 404, { cause: error });
      }
      if (error.status === 409) {
        throw new CastSessionError(error.code, 409, { cause: error });
      }
      if (error.status === 504) {
        throw new CastSessionError("cast_agent_timeout", 504, { cause: error });
      }
    }
    throw new CastSessionError("cast_agent_unavailable", 503, {
      cause: error,
    });
  }
}

async function withCapabilityStore<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    throw new CastSessionError("display_capability_unavailable", 503, {
      cause: error,
    });
  }
}

function publicDevice(device: CastAgentDevice, sessionId: string) {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    online: device.online,
    active: device.activeSessionId === sessionId,
    busy:
      device.activeSessionId !== null && device.activeSessionId !== sessionId,
  };
}
