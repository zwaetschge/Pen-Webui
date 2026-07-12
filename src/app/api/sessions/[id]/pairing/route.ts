import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireDM } from "@/lib/auth";
import {
  ensurePairingForHost,
  pairingStateForHost,
  reissuePairingForHost,
} from "@/lib/game/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reissueSchema = z.object({
  characterId: z.string().trim().min(1).max(128),
});

type Context = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

function authFailure(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.code }, { status: 401 });
  }
  return null;
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const state = await pairingStateForHost(id, user.id);
    return state ? NextResponse.json(state) : notFound();
  } catch (error) {
    const response = authFailure(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const state = await ensurePairingForHost(id, user.id);
    return state ? NextResponse.json(state) : notFound();
  } catch (error) {
    const response = authFailure(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const parsed = reissueSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const seat = await reissuePairingForHost(
      id,
      user.id,
      parsed.data.characterId,
    );
    return seat ? NextResponse.json({ seat }) : notFound();
  } catch (error) {
    const response = authFailure(error);
    if (response) return response;
    throw error;
  }
}
