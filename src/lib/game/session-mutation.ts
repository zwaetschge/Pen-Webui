import { prisma } from "@/lib/db";

/**
 * Serialize server-authoritative mutations for one live session.
 *
 * The callback may still use the shared Prisma client; the transaction exists
 * to hold the advisory lock until the async callback completes.
 */
export async function withSessionMutation<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))
      `;
      return fn();
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
