import { Prisma } from "@prisma/client";

type AdvisoryLockClient = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * Serialize all mutations for one physical couch seat.
 *
 * The claim, ensure, and reissue paths deliberately share this exact key so a
 * QR code cannot be consumed while the host is replacing or inspecting it.
 */
export async function lockPairingSeat(
  tx: AdvisoryLockClient,
  sessionId: string,
  characterId: string,
) {
  const key = `couch-pairing:${sessionId}:${characterId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
