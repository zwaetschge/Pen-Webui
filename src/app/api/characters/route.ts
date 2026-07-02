import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { blankSheet } from "@/lib/character/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  campaignId: z.string().min(1).max(128),
  name: z.string().min(2).max(80),
  sheet: z.record(z.string(), z.unknown()).optional(),
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

    const character = await prisma.character.create({
      data: {
        campaignId: body.campaignId,
        ownerId: user.id,
        name: body.name,
        sheet: { ...blankSheet(), ...(body.sheet ?? {}) } as never,
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
