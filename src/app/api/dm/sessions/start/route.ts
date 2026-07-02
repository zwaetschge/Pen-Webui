import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";
import { ensureSessionBootstrap } from "@/lib/game/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireDM();
    const { campaignId } = (await req.json()) as { campaignId: string };

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, hostId: user.id },
    });
    if (!campaign)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    // close any other active session for this campaign
    await prisma.gameSession.updateMany({
      where: { campaignId, endedAt: null },
      data: { endedAt: new Date() },
    });

    const session = await prisma.gameSession.create({
      data: { campaignId },
    });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "playing" },
    });
    await ensureSessionBootstrap(session.id);

    return NextResponse.json({ sessionId: session.id });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
