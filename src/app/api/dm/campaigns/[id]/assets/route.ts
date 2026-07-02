import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";
import { env } from "@/lib/env";
import { openaiFallbackSettings } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, hostId: user.id },
      select: { id: true, status: true },
    });
    if (!campaign)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const imageProvider = env().ASSET_IMAGE_PROVIDER;
    const [assets, imageConfig] = await Promise.all([
      prisma.asset.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          prompt: true,
          backend: true,
          errorMsg: true,
          width: true,
          height: true,
          meta: true,
          generatedAt: true,
        },
      }),
      openaiFallbackSettings(user.id),
    ]);

    const summary = assets.reduce(
      (acc, a) => {
        acc.total++;
        acc[a.status] = (acc[a.status] ?? 0) + 1;
        return acc;
      },
      { total: 0 } as Record<string, number>,
    );

    return NextResponse.json({
      campaign,
      assets,
      summary,
      imageGeneration: {
        provider: imageProvider,
        configured:
          imageProvider === "codex-cli" ? true : imageConfig.configured,
        keySource: imageConfig.hasUserKey
          ? "user"
          : imageConfig.hasGlobalKey
            ? "env"
            : null,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}
