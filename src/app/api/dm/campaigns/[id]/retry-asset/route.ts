import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";
import { queueAssetJob } from "@/lib/asset/queue";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id: campaignId } = await params;
    const { assetId } = (await req.json()) as { assetId: string };

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, campaignId, campaign: { hostId: user.id } },
    });
    if (!asset)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (["pending", "queued", "generating"].includes(asset.status)) {
      return NextResponse.json({ error: "already_running" }, { status: 409 });
    }

    const meta =
      asset.meta && typeof asset.meta === "object" && !Array.isArray(asset.meta)
        ? (asset.meta as Record<string, unknown>)
        : {};

    await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: "queued",
        errorMsg: null,
        jobId: null,
        meta: {
          ...meta,
          regenerationRequestedAt: new Date().toISOString(),
          regenerationBackend: env().ASSET_IMAGE_PROVIDER,
          previousUrl: asset.url ?? meta.previousUrl ?? null,
          previousBackend: asset.backend ?? meta.previousBackend ?? null,
        } as never,
      },
    });
    await queueAssetJob({
      assetId,
      prompt: asset.prompt,
      kind: asset.kind,
      campaignId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}
