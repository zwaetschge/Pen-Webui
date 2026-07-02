import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSessionUser();

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center px-6 py-16">
      <div className="absolute inset-0 -z-10 bg-parchment-grain" />

      <div className="flex flex-col items-center gap-4 text-center">
        <span className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
          Plum Tabletop
        </span>
        <h1 className="font-display text-5xl text-parchment-100 sm:text-6xl">
          Roll for Initiative
        </h1>
        <p className="max-w-xl font-serif text-lg leading-relaxed text-ink-100">
          A self-hosted D&amp;D 5e table where{" "}
          <span className="text-brass-300">Codex</span> sits behind the screen.
          Bring your friends, bring your dice, bring a name.
        </p>

        <div className="brass-divider my-6 max-w-md" />

        {user ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-ink-100">
              Welcome back,{" "}
              <span className="text-parchment-200">
                {user.name ?? user.username}
              </span>
              {user.isDM ? (
                <span className="ml-2 rounded-full border border-brass-400/40 bg-brass-700/30 px-2 py-0.5 text-xs uppercase tracking-wider text-brass-300">
                  DM
                </span>
              ) : null}
            </p>
            <div className="flex gap-3">
              <Link
                href="/campaigns"
                className="rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm font-medium text-parchment-100 transition hover:bg-brass-600/40"
              >
                My Campaigns
              </Link>
              {user.isDM ? (
                <Link
                  href="/dm/new"
                  className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-5 py-2 text-sm font-medium text-parchment-100 transition hover:bg-arcane-500/40"
                >
                  New Campaign
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-ink-200">
              You are not signed in. Authelia handles the door.
            </p>
            <Link
              href="/dm"
              className="rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm font-medium text-parchment-100 transition hover:bg-brass-600/40"
            >
              Sign in as DM
            </Link>
          </div>
        )}
      </div>

      <footer className="absolute bottom-6 text-xs text-ink-200">v0.1.0</footer>
    </main>
  );
}
