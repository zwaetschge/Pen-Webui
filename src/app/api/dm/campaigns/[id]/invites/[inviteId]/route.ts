import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  try {
    const user = await requireDM();
    const { id: campaignId, inviteId } = await params;
    const invite = await prisma.invite.findFirst({
      where: {
        id: inviteId,
        campaignId,
        campaign: { hostId: user.id },
      },
    });
    if (!invite)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    await prisma.invite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}
