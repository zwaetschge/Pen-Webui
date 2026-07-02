import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDM, AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireDM();
    const campaigns = await prisma.campaign.findMany({
      where: { hostId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        theme: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { npcs: true, locations: true, sessions: true } },
      },
    });
    return NextResponse.json({ campaigns });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}
