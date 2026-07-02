import { handleSessionStream } from "@/lib/game/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleSessionStream(req, id, token);
}
