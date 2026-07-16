import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireDM } from "@/lib/auth";
import {
  castStateForHost,
  CastSessionError,
  startCastForHost,
  stopCastForHost,
} from "@/lib/cast/session-cast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(160),
});

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return withCastRoute(params, (id, hostId) =>
    castStateForHost(id, hostId).then((state) => NextResponse.json(state)),
  );
}

export async function POST(request: Request, { params }: Context) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "cross_origin" }, { status: 403 });
  }
  const body = deviceSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return withCastRoute(params, async (id, hostId) => {
    const cast = await startCastForHost(id, hostId, body.data.deviceId);
    return NextResponse.json({ cast }, { status: 202 });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "cross_origin" }, { status: 403 });
  }
  const body = deviceSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return withCastRoute(params, async (id, hostId) => {
    const cast = await stopCastForHost(id, hostId, body.data.deviceId);
    return NextResponse.json({ cast });
  });
}

async function withCastRoute(
  params: Promise<{ id: string }>,
  run: (sessionId: string, hostId: string) => Promise<NextResponse>,
) {
  try {
    const user = await requireDM();
    const { id } = await params;
    return await run(id, user.id);
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : 403;
      return NextResponse.json({ error: error.code }, { status });
    }
    if (error instanceof CastSessionError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
