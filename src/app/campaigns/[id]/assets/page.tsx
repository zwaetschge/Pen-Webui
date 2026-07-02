import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AssetDashboard } from "./_components/AssetDashboard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AssetsPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, hostId: user.id },
    select: { id: true, title: true, status: true },
  });
  if (!campaign) notFound();

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
          Asset dashboard
        </p>
        <h1 className="font-display text-3xl text-parchment-100">
          {campaign.title}
        </h1>
      </header>

      <AssetDashboard campaignId={campaign.id} />
    </main>
  );
}
