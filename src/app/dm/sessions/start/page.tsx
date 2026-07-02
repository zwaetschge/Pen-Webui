import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { StartSessionTrigger } from "./_components/StartSessionTrigger";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ campaign?: string }> };

export default async function StartSessionPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user || !user.isDM) redirect("/");

  const { campaign: campaignId } = await searchParams;
  if (!campaignId) redirect("/campaigns");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, hostId: user.id },
    select: { id: true, title: true, status: true },
  });
  if (!campaign) redirect("/campaigns");

  return (
    <main className="mx-auto max-w-xl px-6 py-12 text-center">
      <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
        Open the table
      </p>
      <h1 className="mt-2 font-display text-3xl text-parchment-100">
        {campaign.title}
      </h1>
      <p className="mt-4 font-serif text-ink-100">
        Starting a session will mark the campaign as <em>playing</em> and
        broadcast a new room. Existing sessions for this campaign will be closed.
      </p>
      <StartSessionTrigger campaignId={campaign.id} />
    </main>
  );
}
