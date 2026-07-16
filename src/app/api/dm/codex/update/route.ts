import { NextResponse } from "next/server";
import { AuthError, requireDM } from "@/lib/auth";
import {
  CodexUpdateError,
  codexUpdateStatus,
  updateCodexCli,
} from "@/lib/dm/codex-updater";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireDM();
    return NextResponse.json({ ok: true, status: await codexUpdateStatus() });
  } catch (error) {
    return updateErrorResponse(error);
  }
}

/** Update to the fixed, allowlisted @openai/codex@latest package. */
export async function POST() {
  try {
    await requireDM();
    return NextResponse.json({ ok: true, result: await updateCodexCli() });
  } catch (error) {
    return updateErrorResponse(error);
  }
}

function updateErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "UNAUTHENTICATED" ? 401 : 403;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message:
            status === 401
              ? "Anmeldung erforderlich."
              : "Nur ein Dungeon Master darf Codex aktualisieren.",
        },
      },
      { status },
    );
  }

  if (error instanceof CodexUpdateError) {
    const status =
      error.code === "UPDATE_IN_PROGRESS"
        ? 409
        : error.code === "MANAGED_UPDATE_DISABLED"
          ? 409
          : error.code === "UPDATE_TIMEOUT"
            ? 504
            : 502;
    return NextResponse.json(
      {
        ok: false,
        error: { code: error.code, message: error.message },
      },
      { status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Der Codex-Update-Status konnte nicht verarbeitet werden.",
      },
    },
    { status: 500 },
  );
}
