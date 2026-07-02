import { handleCombatAction } from "@/lib/game/combat-action-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleCombatAction(req, id, token);
}
