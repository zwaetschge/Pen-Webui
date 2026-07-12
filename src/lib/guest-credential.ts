import { fromB64url, b64url, sign } from "./invite-token";
import { timingSafeEqual } from "node:crypto";

export type GuestCredential = {
  sessionId: string;
  memberId: string;
  inviteId: string;
  expiryUnix: number;
};

export function guestCookieName(sessionId: string) {
  return `plum_guest_${sessionId}`;
}

export function buildGuestCredential(input: {
  sessionId: string;
  memberId: string;
  inviteId: string;
  expiresAt: Date;
}) {
  const payload = b64url(
    JSON.stringify({
      sessionId: input.sessionId,
      memberId: input.memberId,
      inviteId: input.inviteId,
      expiryUnix: Math.floor(input.expiresAt.getTime() / 1000),
    }),
  );
  return `${payload}.${sign(payload)}`;
}

export function parseGuestCredential(token: string): GuestCredential | null {
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expectedSignature = sign(payload);
  const actual = fromB64url(signature);
  const expected = fromB64url(expectedSignature);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    signature !== expectedSignature
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromB64url(payload).toString("utf8")) as {
      sessionId?: unknown;
      memberId?: unknown;
      inviteId?: unknown;
      expiryUnix?: unknown;
    };
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.memberId !== "string" ||
      typeof parsed.inviteId !== "string" ||
      typeof parsed.expiryUnix !== "number" ||
      !Number.isFinite(parsed.expiryUnix)
    ) {
      return null;
    }
    if (parsed.expiryUnix * 1000 < Date.now()) return null;
    return {
      sessionId: parsed.sessionId,
      memberId: parsed.memberId,
      inviteId: parsed.inviteId,
      expiryUnix: parsed.expiryUnix,
    };
  } catch {
    return null;
  }
}
