import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 2;
const TOKEN_AUDIENCE = "plum-display";
const TOKEN_DOMAIN = "plum-display-token:v2\0";
const MAX_TOKEN_LENGTH = 2048;

type WireClaims = {
  v: number;
  aud: string;
  sid: string;
  cap: string;
  exp: number;
};

export type DisplayTokenClaims = {
  version: 2;
  audience: "plum-display";
  sessionId: string;
  capabilityId: string;
  expiryUnix: number;
};

export function buildDisplayToken(
  input: { sessionId: string; capabilityId: string; expiryUnix: number },
  secret: string,
) {
  const sessionId = input.sessionId.trim();
  const capabilityId = input.capabilityId.trim();
  if (!validSessionId(sessionId)) throw new Error("invalid_session_id");
  if (!validCapabilityId(capabilityId))
    throw new Error("invalid_capability_id");
  if (!Number.isSafeInteger(input.expiryUnix) || input.expiryUnix <= 0) {
    throw new Error("invalid_expiry");
  }
  if (secret.length < 16) throw new Error("invalid_secret");

  const body = Buffer.from(
    JSON.stringify({
      v: TOKEN_VERSION,
      aud: TOKEN_AUDIENCE,
      sid: sessionId,
      cap: capabilityId,
      exp: input.expiryUnix,
    } satisfies WireClaims),
    "utf8",
  ).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function parseDisplayToken(
  token: string,
  secret: string,
  opts?: { nowUnix?: number },
): DisplayTokenClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || secret.length < 16) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, receivedSignature] = parts;
  const expectedSignature = signature(body, secret);
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const claims = raw as Partial<WireClaims>;
  if (
    claims.v !== TOKEN_VERSION ||
    claims.aud !== TOKEN_AUDIENCE ||
    typeof claims.sid !== "string" ||
    !validSessionId(claims.sid) ||
    typeof claims.cap !== "string" ||
    !validCapabilityId(claims.cap) ||
    !Number.isSafeInteger(claims.exp)
  ) {
    return null;
  }

  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000);
  if ((claims.exp as number) < nowUnix) return null;

  return {
    version: TOKEN_VERSION,
    audience: TOKEN_AUDIENCE,
    sessionId: claims.sid,
    capabilityId: claims.cap,
    expiryUnix: claims.exp as number,
  };
}

function signature(body: string, secret: string) {
  return createHmac("sha256", secret)
    .update(TOKEN_DOMAIN, "utf8")
    .update(body, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function validSessionId(value: string) {
  return (
    value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validCapabilityId(value: string) {
  return (
    value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value)
  );
}
