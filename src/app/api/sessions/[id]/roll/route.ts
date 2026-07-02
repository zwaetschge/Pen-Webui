import { handleSessionRoll } from "@/lib/game/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionRoll(req, id);
}
