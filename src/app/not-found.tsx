import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
        404 — out of bounds
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100">
        Nothing here
      </h1>
      <p className="mt-3 font-serif text-ink-100">
        The page you sought has wandered off the map.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
      >
        Back to start
      </Link>
    </main>
  );
}
