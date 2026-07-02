import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function DMHome() {
  const user = await getSessionUser();

  if (!user) {
    // Authelia should have intercepted before us; this is a defensive fallback.
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl text-parchment-100">
          Authentication required
        </h1>
        <p className="mt-3 font-serif text-ink-100">
          You should have been redirected to Authelia. Check Traefik labels
          for <code className="text-brass-300">authelia@docker</code>.
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

  if (!user.isDM) {
    redirect("/campaigns");
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
          Dungeon Master
        </p>
        <h1 className="font-display text-4xl text-parchment-100">
          Welcome, {user.name ?? user.username}
        </h1>
        <div className="brass-divider mt-6" />
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-6">
          <h2 className="font-display text-xl text-parchment-200">
            Start a new campaign
          </h2>
          <p className="mt-2 text-sm text-ink-100">
            Open the worldbuilding wizard. Codex drafts plot, NPCs, locations,
            and queues asset generation while you review.
          </p>
          <Link
            href="/dm/new"
            className="mt-4 inline-block rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-sm text-parchment-100 transition hover:bg-arcane-500/40"
          >
            New campaign →
          </Link>
        </div>

        <div className="panel p-6">
          <h2 className="font-display text-xl text-parchment-200">
            Continue a campaign
          </h2>
          <p className="mt-2 text-sm text-ink-100">
            Resume a session, manage NPCs, or invite players.
          </p>
          <Link
            href="/campaigns"
            className="mt-4 inline-block rounded-md border border-brass-400/60 bg-brass-700/30 px-4 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
          >
            My campaigns →
          </Link>
        </div>
      </section>
    </main>
  );
}
