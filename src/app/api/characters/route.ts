import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { blankSheet } from "@/lib/character/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  campaignId: z.string().min(1).max(128),
  name: z.string().min(2).max(80).optional(),
  sourceNpcId: z.string().min(1).max(128).optional(),
  sheet: z.record(z.string(), z.unknown()).optional(),
}).refine((body) => body.name || body.sourceNpcId, {
  message: "name_or_source_required",
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());

    const campaign = await prisma.campaign.findUnique({
      where: { id: body.campaignId },
      select: { id: true, hostId: true },
    });
    if (!campaign)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (campaign.hostId !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const sourceNpc = body.sourceNpcId
      ? await prisma.nPC.findFirst({
          where: { id: body.sourceNpcId, campaignId: body.campaignId },
          select: {
            id: true,
            name: true,
            role: true,
            description: true,
            portraitAssetId: true,
            tokenAssetId: true,
          },
        })
      : null;
    if (body.sourceNpcId && !sourceNpc) {
      return NextResponse.json(
        { error: "source_npc_not_found" },
        { status: 404 },
      );
    }

    const templateSheet = sourceNpc
      ? {
          appearance: sourceNpc.description ?? "",
          backstory: [sourceNpc.role, sourceNpc.description]
            .filter((part): part is string => Boolean(part?.trim()))
            .join("\n\n"),
          notes: `Aus Kampagnenfigur "${sourceNpc.name}" als spielbarer Charakter uebernommen.`,
          sourceNpcId: sourceNpc.id,
          sourceNpcName: sourceNpc.name,
          sourceNpcRole: sourceNpc.role ?? "",
          sourceNpcDescription: sourceNpc.description ?? "",
        }
      : {};

    const character = await prisma.character.create({
      data: {
        campaignId: body.campaignId,
        ownerId: user.id,
        name: body.name?.trim() || sourceNpc?.name || "Character",
        portraitAssetId: sourceNpc?.portraitAssetId ?? undefined,
        tokenAssetId: sourceNpc?.tokenAssetId ?? undefined,
        sheet: (sourceNpc
          ? {
              ...blankSheet(),
              ...(body.sheet ?? {}),
              ...templateSheet,
            }
          : {
              ...blankSheet(),
              ...(body.sheet ?? {}),
            }) as never,
      },
    });
    return NextResponse.json({ character });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
