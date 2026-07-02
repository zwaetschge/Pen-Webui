import { NextResponse } from "next/server";
import { AuthError, requireDM } from "@/lib/auth";
import { closeTerminalSession } from "@/lib/dm/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    const closed = closeTerminalSession(id, user.id);
    return NextResponse.json({ ok: true, closed });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg.includes("disabled") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
