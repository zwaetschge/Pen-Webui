import { NextResponse } from "next/server";
import { requireDM, AuthError } from "@/lib/auth";
import {
  wizardInputSchema,
  draftBlueprint,
  commitBlueprint,
} from "@/lib/dm/worldbuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const user = await requireDM();
    const body = await req.json();
    const input = wizardInputSchema.parse(body);

    const blueprint = await draftBlueprint(user.id, input);
    const { campaignId } = await commitBlueprint({
      hostId: user.id,
      input,
      blueprint,
    });

    return NextResponse.json({ campaignId, blueprint });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
