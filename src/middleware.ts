/**
 * Edge middleware — minimal sanity gate for `/dm` and `/api/dm` routes.
 *
 * The real authentication is enforced by Traefik+Authelia BEFORE the request
 * reaches Next.js.  This middleware exists as a defense-in-depth check that
 * the Authelia Remote-User header is actually present on protected paths.
 * If it is missing (e.g. someone bypassed Traefik), we 401 instead of
 * silently allowing access.
 *
 * Player invite routes (`/play/invite/*`, `/api/invite/*`) are explicitly
 * exempted — those use HMAC tokens in the URL, validated server-side in
 * lib/invite.ts.
 */

import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dm",
  "/api/dm",
  "/campaigns",
  "/api/campaigns",
  "/table",
  "/api/sessions",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const remoteUser =
    req.headers.get("remote-user") ||
    req.headers.get(process.env.AUTHELIA_HEADER_USER ?? "Remote-User");

  // Dev fallback — same env-flag the auth lib reads.
  const devBypass =
    process.env.NODE_ENV === "development" && !!process.env.DEV_AUTH_USER;

  if (!remoteUser && !devBypass) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "unauthenticated",
          hint: "request did not arrive via Authelia",
        },
        { status: 401 },
      );
    }
    return new NextResponse(
      "Unauthenticated — request did not arrive via Authelia/Traefik.",
      { status: 401, headers: { "content-type": "text/plain" } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dm/:path*",
    "/api/dm/:path*",
    "/campaigns/:path*",
    "/api/campaigns/:path*",
    "/table/:path*",
    "/api/sessions/:path*",
  ],
};
