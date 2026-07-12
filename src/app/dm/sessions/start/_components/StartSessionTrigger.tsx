"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StartSessionTrigger({
  campaignId,
  canStart = true,
  characterUrl = `/campaigns/${campaignId}/characters/new`,
}: {
  campaignId: string;
  canStart?: boolean;
  characterUrl?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    if (!canStart) {
      setErr("Lege zuerst eine spielbare Figur an.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/dm/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.error === "character_required") {
          setErr("Lege zuerst eine spielbare Figur an.");
          return;
        }
        throw new Error(j.error ?? "failed");
      }
      const { sessionId } = (await r.json()) as { sessionId: string };
      router.push(`/table/sessions/${sessionId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={busy || !canStart}
        onClick={start}
        className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-6 py-3 font-display text-sm uppercase tracking-wider text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-50"
      >
        {busy ? "Tisch wird geöffnet…" : "Gemeinschaftstisch öffnen"}
      </button>
      {!canStart ? (
        <button
          type="button"
          onClick={() => router.push(characterUrl)}
          className="ml-3 rounded-md border border-brass-400/60 bg-brass-700/30 px-6 py-3 font-display text-sm uppercase tracking-wider text-parchment-100 hover:bg-brass-600/40"
        >
          Figur anlegen
        </button>
      ) : null}
      {err ? <p className="mt-3 text-sm text-blood-500">{err}</p> : null}
    </div>
  );
}
