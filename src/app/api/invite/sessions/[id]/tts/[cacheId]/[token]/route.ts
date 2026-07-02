import { handleSessionTtsAudio } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  {
    params,
  }: { params: Promise<{ id: string; cacheId: string; token: string }> },
) {
  const { id, cacheId, token } = await params;
  return handleSessionTtsAudio(req, id, cacheId, token);
}
