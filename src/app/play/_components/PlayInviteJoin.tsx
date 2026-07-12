import Link from "next/link";
import { verifyToken } from "@/lib/invite";
import { prisma } from "@/lib/db";
import { AutoClaimInvite } from "./AutoClaimInvite";

export async function PlayInviteJoin({ token }: { token: string }) {
  const invite = await verifyToken(token);

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl text-parchment-100">
          Einladung ungültig oder abgelaufen
        </h1>
        <p className="mt-3 font-serif text-ink-100">
          Bitte deinen Dungeon Master um einen neuen Einladungslink.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
        >
          Zur Startseite
        </Link>
      </main>
    );
  }

  const active = await prisma.gameSession.findFirst({
    where: {
      ...(invite.sessionId ? { id: invite.sessionId } : {}),
      campaignId: invite.campaignId,
      endedAt: null,
    },
    ...(invite.sessionId ? {} : { orderBy: { startedAt: "desc" as const } }),
  });

  if (active) {
    return <AutoClaimInvite sessionId={active.id} token={token} />;
  }

  if (invite.sessionId) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl text-parchment-100">
          Diese Einladung ist nicht mehr verfügbar.
        </h1>
        <p className="mt-3 font-serif text-ink-100">
          Bitte deinen Dungeon Master um einen neuen Einladungslink.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
        >
          Zur Startseite
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
        Du wurdest eingeladen zu
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100">
        {invite.campaign.title}
      </h1>
      <p className="mt-4 font-serif text-ink-100">
        Thema: <span className="text-brass-300">{invite.campaign.theme}</span>
      </p>

      <div className="brass-divider my-8 max-w-md" />

      <p className="font-serif text-sm text-ink-100">
        Der Dungeon Master hat den Spieltisch noch nicht geöffnet. Lass diesen
        Tab offen — du wirst automatisch verbunden, sobald die Sitzung beginnt.
      </p>

      <meta httpEquiv="refresh" content="20" />
    </main>
  );
}
