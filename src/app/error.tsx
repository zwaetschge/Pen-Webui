"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-xs uppercase tracking-[0.4em] text-blood-500">
        Disaster
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100">
        Something rolled a natural 1
      </h1>
      <p className="mt-3 max-w-md font-serif text-ink-100">
        {error.message ?? "The server stumbled."}
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-ink-200">id: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md border border-brass-400/60 bg-brass-700/30 px-5 py-2 text-sm text-parchment-100 transition hover:bg-brass-600/40"
      >
        Try again
      </button>
    </main>
  );
}
