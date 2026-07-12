/**
 * Pure HMAC token build + parse (no DB).  Kept separate from invite.ts so
 * unit tests don't need to load Prisma.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function hmacSecret(): string {
  const v = process.env.INVITE_HMAC_SECRET;
  if (!v) throw new Error("INVITE_HMAC_SECRET not set");
  return v;
}

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromB64url(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function sign(payload: string): string {
  return b64url(createHmac("sha256", hmacSecret()).update(payload).digest());
}

/** Construct a token string. */
export function buildToken(inviteId: string, expiresAt: Date): string {
  const expiry = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${inviteId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

/** Parse + verify the cryptographic part of a token.  Returns the inviteId and
 *  expiry unix-seconds when valid, or null otherwise.  Does NOT check the DB. */
export function parseToken(
  token: string,
): { inviteId: string; expiryUnix: number } | null {
  if (token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [inviteId, expiryStr, sigB64] = parts;
  const expectedSig = sign(`${inviteId}.${expiryStr}`);
  const a = fromB64url(sigB64);
  const b = fromB64url(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b) || sigB64 !== expectedSig)
    return null;
  const expiryUnix = Number(expiryStr);
  if (!Number.isFinite(expiryUnix)) return null;
  return { inviteId, expiryUnix };
}
