import { Suspense } from "react";
import { SRDBrowser } from "./_components/SRDBrowser";

export const dynamic = "force-dynamic";

const TYPES = [
  "spell",
  "monster",
  "rule",
  "item",
  "class",
  "race",
  "background",
  "feat",
  "condition",
  "feature",
] as const;

export default function SRDPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
          Rules Compendium
        </p>
        <h1 className="font-display text-4xl text-parchment-100">
          D&amp;D 5.1 SRD
        </h1>
        <div className="brass-divider mt-6" />
      </header>

      <Suspense fallback={<div className="text-ink-100">Loading…</div>}>
        <SRDBrowser types={TYPES as unknown as string[]} />
      </Suspense>
    </main>
  );
}
