import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { WorldbuildWizard } from "./_components/WorldbuildWizard";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (!user.isDM) redirect("/campaigns");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
          Worldbuilding
        </p>
        <h1 className="font-display text-4xl text-parchment-100">
          Forge a new campaign
        </h1>
        <p className="mt-2 font-serif text-ink-100">
          Codex drafts the plot, NPCs, locations, and queues asset generation.
          Review and refine before opening the table.
        </p>
      </header>

      <WorldbuildWizard />
    </main>
  );
}
