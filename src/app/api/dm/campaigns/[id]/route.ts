import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";
import { removeQueuedAssetJobsForCampaign } from "@/lib/asset/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id: campaignId } = await params;

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, hostId: user.id },
      select: { id: true },
    });
    if (!campaign)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const removedQueuedJobs = await removeQueuedAssetJobsForCampaign(
      campaignId,
    ).catch(() => 0);

    const result = await prisma.$transaction(async (tx) => {
      await tx.character.deleteMany({ where: { campaignId } });
      await tx.nPC.deleteMany({ where: { campaignId } });
      await tx.location.deleteMany({ where: { campaignId } });
      await tx.item.deleteMany({ where: { campaignId } });
      const deletedAssets = await tx.asset.deleteMany({
        where: { campaignId },
      });
      const deletedCampaign = await tx.campaign.deleteMany({
        where: { id: campaignId, hostId: user.id },
      });

      return {
        deletedAssets: deletedAssets.count,
        deletedCampaigns: deletedCampaign.count,
      };
    });

    if (result.deletedCampaigns !== 1) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      deletedAssets: result.deletedAssets,
      removedQueuedJobs,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}
