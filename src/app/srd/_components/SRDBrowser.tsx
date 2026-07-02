"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Hit = {
  id: string;
  type: string;
  name: string;
  slug: string;
  snippet: string;
  score: number;
};

export function SRDBrowser({ types }: { types: string[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => {
      const query = q.trim();
      if (!query) {
        setHits([]);
        return;
      }
      startTransition(async () => {
        try {
          const url = new URL("/api/srd/search", window.location.origin);
          url.searchParams.set("q", query);
          if (type) url.searchParams.set("type", type);
          const r = await fetch(url.toString());
          if (!r.ok) throw new Error(`search failed (${r.status})`);
          const json = await r.json();
          setHits(json.hits ?? []);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "search failed");
        }
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q, type]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-4">
        <div>
          <label className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
            Search
          </label>
          <input
            autoFocus
            type="text"
            placeholder="fireball, owlbear, grapple…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-2 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
          />
        </div>

        <div>
          <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
            Type
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <TypeChip active={type === ""} onClick={() => setType("")}>
              all
            </TypeChip>
            {types.map((t) => (
              <TypeChip
                key={t}
                active={type === t}
                onClick={() => setType(t)}
              >
                {t}
              </TypeChip>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        {error ? (
          <p className="text-sm text-blood-500">{error}</p>
        ) : null}

        {!q.trim() ? (
          <p className="font-serif text-ink-100">
            Type a spell, monster, rule or item.
          </p>
        ) : pending && hits.length === 0 ? (
          <p className="font-serif text-ink-100">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="font-serif text-ink-100">No matches.</p>
        ) : (
          <ul className="space-y-3">
            {hits.map((h) => (
              <li
                key={h.id}
                className="panel p-4 transition hover:border-brass-400/60"
              >
                <Link
                  href={`/srd/${h.slug}`}
                  className="flex items-center justify-between"
                >
                  <h3 className="font-display text-lg text-parchment-100">
                    {h.name}
                  </h3>
                  <span className="rounded-full border border-brass-700/40 bg-ink-600/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass-300">
                    {h.type}
                  </span>
                </Link>
                <p className="mt-2 font-serif text-sm leading-relaxed text-ink-100">
                  {h.snippet}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs uppercase tracking-wider transition",
        active
          ? "border-brass-400/60 bg-brass-700/40 text-parchment-100"
          : "border-brass-700/40 bg-ink-600/60 text-ink-100 hover:border-brass-400/40 hover:text-parchment-200",
      )}
    >
      {children}
    </button>
  );
}
