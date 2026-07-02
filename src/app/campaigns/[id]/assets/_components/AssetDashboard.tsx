"use client";

import { useCallback, useEffect, useState } from "react";

type Asset = {
  id: string;
  kind: string;
  status: "pending" | "queued" | "generating" | "ready" | "failed";
  url: string | null;
  prompt: string;
  backend: string | null;
  errorMsg: string | null;
  width: number | null;
  height: number | null;
  meta?: {
    librarySource?: string;
    libraryAssetId?: string;
    pregenSlug?: string;
  } | null;
};

const STATUS_PILL: Record<Asset["status"], string> = {
  pending: "border-ink-200/40 bg-ink-500/60 text-ink-100",
  queued: "border-ink-200/40 bg-ink-500/60 text-ink-100",
  generating: "border-arcane-500/40 bg-arcane-600/30 text-arcane-400",
  ready: "border-brass-400/60 bg-brass-700/30 text-brass-300",
  failed: "border-blood-500/60 bg-blood-600/30 text-parchment-100",
};

export function AssetDashboard({ campaignId }: { campaignId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [imageGeneration, setImageGeneration] = useState<{
    provider: "codex-cli" | "openai-api";
    configured: boolean;
    keySource: "user" | "env" | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/dm/campaigns/${campaignId}/assets`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`failed (${r.status})`);
      const j = await r.json();
      setAssets(j.assets);
      setSummary(j.summary);
      setImageGeneration(j.imageGeneration ?? null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const stillWorking = assets.some(
      (x) =>
        x.status === "pending" ||
        x.status === "queued" ||
        x.status === "generating",
    );
    if (!stillWorking) return;
    const interval = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(interval);
  }, [assets, load]);

  async function regenerate(assetId: string) {
    setRegenerating(assetId);
    setErr(null);
    try {
      const response = await fetch(
        `/api/dm/campaigns/${campaignId}/retry-asset`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          body.message ??
            body.error ??
            `regenerate failed (${response.status})`,
        );
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "regenerate failed");
    } finally {
      setRegenerating(null);
    }
  }

  return (
    <div>
      <SummaryBar summary={summary} />
      {imageGeneration && !imageGeneration.configured ? (
        <div className="mt-4 rounded-md border border-blood-500/50 bg-blood-600/15 p-3 text-sm text-parchment-100">
          Asset generation is set to OpenAI API mode and needs an API key. Add a
          key in{" "}
          <a href="/dm/settings" className="text-brass-300 underline">
            DM settings
          </a>
          .
        </div>
      ) : null}
      {err ? <p className="text-sm text-blood-500">{err}</p> : null}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((a) => (
          <li key={a.id} className="panel overflow-hidden">
            <div className="relative aspect-square w-full bg-ink-600">
              {a.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={a.url}
                  alt={a.kind}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-ink-200">
                  {a.status === "failed" ? "failed" : "waiting"}
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-[11px] uppercase tracking-wider text-brass-400">
                  {a.kind.replace(/_/g, " ")}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_PILL[a.status]}`}
                >
                  {a.status}
                </span>
              </div>
              <p
                className="mt-2 line-clamp-3 font-serif text-xs text-ink-100"
                title={a.prompt}
              >
                {a.prompt}
              </p>
              {a.errorMsg ? (
                <p className="mt-1 text-[11px] text-blood-500">
                  {a.errorMsg.slice(0, 140)}
                </p>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="truncate text-[11px] text-ink-200">
                  {assetSource(a)}
                </p>
                <button
                  type="button"
                  disabled={isWorking(a.status) || regenerating === a.id}
                  onClick={() => regenerate(a.id)}
                  className="shrink-0 rounded-md border border-brass-400/60 bg-brass-700/30 px-2 py-1 text-[11px] text-parchment-100 hover:bg-brass-600/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {regenerating === a.id
                    ? "Queued"
                    : a.status === "failed"
                      ? "Retry"
                      : "Regenerate"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isWorking(status: Asset["status"]) {
  return status === "pending" || status === "queued" || status === "generating";
}

function assetSource(asset: Asset) {
  if (asset.meta?.librarySource === "generated") return "Library";
  if (asset.meta?.librarySource === "pregenerated") return "Pregenerated";
  if (asset.backend) return asset.backend;
  return "Unassigned";
}

function SummaryBar({ summary }: { summary: Record<string, number> }) {
  const order = ["pending", "queued", "generating", "ready", "failed"];
  const total = summary.total ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-ink-100">
        Total: <strong className="text-parchment-100">{total}</strong>
      </span>
      {order.map((k) =>
        summary[k] ? (
          <span
            key={k}
            className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${
              STATUS_PILL[k as Asset["status"]]
            }`}
          >
            {k} · {summary[k]}
          </span>
        ) : null,
      )}
    </div>
  );
}
