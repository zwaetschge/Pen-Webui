/**
 * HMAC-signed invite tokens for non-Authelia players.
 *
 * A player joins via /play/invite/<token>.  Traefik routes invite-only paths
 * around Authelia (see docker-compose labels); this module validates the token
 * against the DB (so revocation is real-time).
 *
 * The pure HMAC build/parse half lives in `invite-token.ts` so unit tests
 * don't need to load Prisma.
 */

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { buildToken, parseToken } from "./invite-token";

export { buildToken } from "./invite-token";

/** Verify a token string.  Returns the invite row if valid + unused. */
export async function verifyToken(token: string) {
  const parsed = parseToken(token);
  if (!parsed) return null;
  if (parsed.expiryUnix * 1000 < Date.now()) return null;

  const invite = await prisma.invite.findUnique({
    where: { id: parsed.inviteId },
    include: { campaign: true },
  });
  if (!invite) return null;
  if (invite.revokedAt) return null;
  if (invite.usedAt) return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;
  return invite;
}

/** Generate a fresh invite for a campaign. */
export async function createInvite(
  opts: {
    campaignId: string;
    issuedById: string;
    displayName?: string;
    ttlHours?: number;
    sessionId?: string;
    characterId?: string;
  },
  db?: Prisma.TransactionClient,
) {
  const ttlHours = Math.min(Math.max(opts.ttlHours ?? 168, 1), 24 * 30);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  // Pre-generate a CUID-ish id so we can embed it in the token.
  const id = `inv_${randomBytes(12).toString("hex")}`;
  const code = buildToken(id, expiresAt);

  const invite = await (db ?? prisma).invite.create({
    data: {
      id,
      campaignId: opts.campaignId,
      issuedById: opts.issuedById,
      sessionId: opts.sessionId,
      characterId: opts.characterId,
      displayName: opts.displayName?.trim() || undefined,
      expiresAt,
      code,
    },
  });

  return { invite, token: code, url: `/play/invite/${code}` };
}
