"use client";

import { useCallback, useEffect, useState } from "react";

type Invite = {
  id: string;
  code: string;
  displayName: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function InviteManager({ campaignId }: { campaignId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [ttlHours, setTtlHours] = useState(168);
  const [origin, setOrigin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/dm/campaigns/${campaignId}/invites`);
    if (!r.ok) {
      setErr("failed to load invites");
      return;
    }
    const j = await r.json();
    setInvites(j.invites);
  }, [campaignId]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function create() {
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/dm/campaigns/${campaignId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, ttlHours }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "failed");
      }
      setDisplayName("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this invite?")) return;
    setErr(null);
    const response = await fetch(
      `/api/dm/campaigns/${campaignId}/invites/${id}`,
      {
        method: "DELETE",
      },
    );
    if (!response.ok) {
      setErr("failed to revoke invite");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h3 className="font-display text-sm uppercase tracking-[0.3em] text-brass-400">
          New invite
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
          />
          <input
            type="number"
            min={1}
            max={720}
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            className="rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
            title="TTL in hours"
          />
          <button
            type="button"
            disabled={busy || ttlHours < 1}
            onClick={create}
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-sm text-parchment-100 transition hover:bg-arcane-500/40 disabled:opacity-50"
          >
            {busy ? "Minting" : "Mint link"}
          </button>
        </div>
        {err ? <p className="mt-2 text-sm text-blood-500">{err}</p> : null}
      </section>

      <section>
        <h3 className="font-display text-sm uppercase tracking-[0.3em] text-brass-400">
          Issued
        </h3>
        {invites.length === 0 ? (
          <p className="mt-3 font-serif text-sm text-ink-100">
            No invites yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invites.map((inv) => {
              const url = `${origin}/play/invite/${inv.code}`;
              const state = inv.revokedAt
                ? "revoked"
                : inv.usedAt
                  ? "used"
                  : new Date(inv.expiresAt).getTime() < Date.now()
                    ? "expired"
                    : "live";
              return (
                <li
                  key={inv.id}
                  className="panel flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-parchment-100">
                      {inv.displayName ?? "guest"}
                    </p>
                    <button
                      type="button"
                      title="copy invite URL"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(url)
                          .then(() => {
                            setCopiedId(inv.id);
                            window.setTimeout(() => setCopiedId(null), 1600);
                          })
                          .catch(() => setErr("failed to copy invite URL"));
                      }}
                      className="hover:text-brass-200 block truncate text-left text-xs text-brass-300"
                    >
                      {url}
                    </button>
                    <p className="text-[11px] text-ink-200">
                      {copiedId === inv.id
                        ? "copied"
                        : `exp ${new Date(inv.expiresAt).toLocaleString()}`}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      state === "live"
                        ? "border-brass-400/60 bg-brass-700/30 text-brass-300"
                        : "border-ink-200/40 bg-ink-500/60 text-ink-200"
                    }`}
                  >
                    {state}
                  </span>
                  {state === "live" ? (
                    <button
                      type="button"
                      onClick={() => revoke(inv.id)}
                      className="rounded-md border border-blood-500/40 bg-blood-600/20 px-2 py-1 text-[11px] text-blood-500 hover:bg-blood-600/30"
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
