import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";
import { createInvite } from "@/lib/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createInviteSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  ttlHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const owned = await prisma.campaign.findFirst({
      where: { id, hostId: user.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const invites = await prisma.invite.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invites });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const owned = await prisma.campaign.findFirst({
      where: { id, hostId: user.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const body = createInviteSchema.parse(await req.json().catch(() => ({})));

    const { invite, url, token } = await createInvite({
      campaignId: id,
      issuedById: user.id,
      displayName: body.displayName,
      ttlHours: body.ttlHours,
    });

    return NextResponse.json({ invite, url, token });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
