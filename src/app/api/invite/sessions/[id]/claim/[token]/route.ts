import { NextResponse } from "next/server";
import { claimInviteForSession } from "@/lib/game/access";
import { guestCookieName } from "@/lib/guest-credential";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  const claim = await claimInviteForSession(id, token);
  const base = new URL(req.url);

  if (!claim) {
    return NextResponse.redirect(
      new URL(`/play/invite/${encodeURIComponent(token)}`, base),
    );
  }

  const response = NextResponse.redirect(
    new URL(
      `/play/invite/${encodeURIComponent(token)}/sessions/${encodeURIComponent(id)}`,
      base,
    ),
  );
  response.cookies.set(guestCookieName(id), claim.credential, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: claim.maxAgeSeconds,
  });
  return response;
}
