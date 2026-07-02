import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/invite";
import { prisma } from "@/lib/db";

export async function PlayInviteJoin({ token }: { token: string }) {
  const invite = await verifyToken(token);

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl text-parchment-100">
          Invitation invalid or expired
        </h1>
        <p className="mt-3 font-serif text-ink-100">
          Ask your Dungeon Master to issue a fresh link.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
        >
          Back home
        </Link>
      </main>
    );
  }

  const active = await prisma.gameSession.findFirst({
    where: { campaignId: invite.campaignId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (active) {
    redirect(
      `/api/invite/sessions/${encodeURIComponent(active.id)}/claim/${encodeURIComponent(token)}`,
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
        You have been invited to
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100">
        {invite.campaign.title}
      </h1>
      <p className="mt-4 font-serif text-ink-100">
        Theme: <span className="text-brass-300">{invite.campaign.theme}</span>
      </p>

      <div className="brass-divider my-8 max-w-md" />

      <p className="font-serif text-sm text-ink-100">
        The DM hasn&apos;t opened the table yet. Keep this tab open — it will
        join the room automatically when the session starts.
      </p>

      <meta httpEquiv="refresh" content="20" />
    </main>
  );
}
