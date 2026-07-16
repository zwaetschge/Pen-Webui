import {
  handleGameplayCommand,
  handleGameplayState,
} from "@/lib/game/gameplay-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleGameplayState(req, id, token);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleGameplayCommand(req, id, token);
}
