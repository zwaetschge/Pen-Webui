import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireDM } from "@/lib/auth";
import { writeTerminalInput } from "@/lib/dm/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  data: z.string().min(1).max(8192),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const body = schema.parse(await req.json());
    const written = writeTerminalInput(id, user.id, body.data);
    if (!written)
      return NextResponse.json({ error: "terminal not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg.includes("disabled") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
