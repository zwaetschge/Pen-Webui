import { NextResponse } from "next/server";
import { AuthError, requireDM } from "@/lib/auth";
import {
  createTerminalSession,
  cleanupTerminalSessions,
  terminalSettings,
} from "@/lib/dm/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireDM();
    cleanupTerminalSessions();
    return NextResponse.json(terminalSettings());
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST() {
  try {
    const user = await requireDM();
    const session = createTerminalSession(user.id);
    return NextResponse.json(session);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg.includes("disabled") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
