"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DeleteCampaignButtonProps = {
  campaignId: string;
  title: string;
  compact?: boolean;
  redirectAfterDelete?: boolean;
};

export function DeleteCampaignButton({
  campaignId,
  title,
  compact = false,
  redirectAfterDelete = false,
}: DeleteCampaignButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteCampaign() {
    const confirmed = window.confirm(
      `Delete "${title}"? This removes the campaign, sessions, invites, characters, world data, and campaign asset rows.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/dm/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.error ?? "delete_failed");
      }

      if (redirectAfterDelete) {
        router.replace("/campaigns");
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={deleteCampaign}
        className={
          compact
            ? "rounded-md border border-blood-500/50 bg-blood-600/20 px-3 py-1 text-xs text-parchment-100 transition hover:bg-blood-600/35 disabled:opacity-50"
            : "w-full rounded-md border border-blood-500/50 bg-blood-600/20 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-blood-600/35 disabled:opacity-50"
        }
      >
        {busy ? "Deleting" : compact ? "Delete" : "Delete campaign"}
      </button>
      {error ? <p className="mt-2 text-xs text-blood-500">{error}</p> : null}
    </div>
  );
}
