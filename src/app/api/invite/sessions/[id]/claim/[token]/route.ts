import { NextResponse } from "next/server";
import { claimInviteForSession } from "@/lib/game/access";
import { guestCookieName } from "@/lib/guest-credential";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  _req: Request,
  _context: { params: Promise<{ id: string; token: string }> },
) {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { allow: "POST" } },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  const claim = await claimInviteForSession(id, token);

  if (!claim) {
    return NextResponse.json(
      { error: "invite_unavailable" },
      { status: 409 },
    );
  }

  const redirectTo = `/play/invite/${encodeURIComponent(
    token,
  )}/sessions/${encodeURIComponent(id)}`;
  const response = NextResponse.json({ redirectTo });
  response.cookies.set(guestCookieName(id), claim.credential, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: claim.maxAgeSeconds,
  });
  return response;
}
