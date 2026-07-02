import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  sheet: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const ch = await prisma.character.findFirst({
      where: {
        id,
        OR: [{ ownerId: user.id }, { campaign: { hostId: user.id } }],
      },
    });
    if (!ch) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ character: ch });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = updateSchema.parse(await req.json());

    const ch = await prisma.character.findFirst({
      where: {
        id,
        OR: [{ ownerId: user.id }, { campaign: { hostId: user.id } }],
      },
    });
    if (!ch) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const updated = await prisma.character.update({
      where: { id },
      data: {
        name: body.name,
        sheet: body.sheet ? (body.sheet as never) : undefined,
      },
    });
    return NextResponse.json({ character: updated });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
