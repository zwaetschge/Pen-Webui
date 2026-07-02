import { handleInviteSessionVoiceAssignments } from "@/lib/tts/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleInviteSessionVoiceAssignments(req, id, token);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleInviteSessionVoiceAssignments(req, id, token);
}
