import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { InviteManager } from "./_components/InviteManager";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function InvitesPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, hostId: user.id },
    select: { id: true, title: true },
  });
  if (!campaign) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
          Invitations
        </p>
        <h1 className="font-display text-3xl text-parchment-100">
          {campaign.title}
        </h1>
        <p className="mt-2 font-serif text-sm text-ink-100">
          Send a one-link invite to a friend who doesn&apos;t have an Authelia
          account. The link is single-use after first character pick and
          expires automatically.
        </p>
      </header>

      <InviteManager campaignId={campaign.id} />
    </main>
  );
}
