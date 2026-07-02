import { handleSessionTtsAudio } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; cacheId: string }> },
) {
  const { id, cacheId } = await params;
  return handleSessionTtsAudio(req, id, cacheId);
}
