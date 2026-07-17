import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/request-origin";
import { resolveAccess } from "./access";
import { publishEvent } from "./bus";

const stageViewSchema = z.object({
  view: z.enum(["map", "cinematic"]),
});

export async function handleStageView(req: Request, sessionId: string) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ error: "cross_origin" }, { status: 403 });
  }

  const parsed = stageViewSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const access = await resolveAccess({ sessionId });
  if (!access || access.role !== "host") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await publishEvent(
    sessionId,
    "stage_view_set",
    { view: parsed.data.view },
    { actorId: access.userId },
  );
  return NextResponse.json(
    { ok: true, view: parsed.data.view },
    { status: 202 },
  );
}
