import { describe, expect, it, vi } from "vitest";
import {
  fetchCodexUpdateStatus,
  requestCodexUpdate,
} from "./codex-update-request";

const status = {
  available: true,
  currentVersion: "0.134.0",
  source: "bundled" as const,
  managed: false,
  canUpdate: true,
  updating: false,
};

describe("Codex update requests", () => {
  it("loads and validates the active CLI status", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, status }));

    await expect(fetchCodexUpdateStatus(fetcher)).resolves.toEqual(status);
    expect(fetcher).toHaveBeenCalledWith("/api/dm/codex/update", {
      cache: "no-store",
    });
  });

  it("updates Codex without sending user-controlled command data", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          previousVersion: "0.134.0",
          currentVersion: "0.144.5",
          changed: true,
          status: {
            ...status,
            currentVersion: "0.144.5",
            source: "managed",
            managed: true,
          },
        },
      }),
    );

    await expect(requestCodexUpdate(fetcher)).resolves.toMatchObject({
      previousVersion: "0.134.0",
      currentVersion: "0.144.5",
      changed: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/dm/codex/update", {
      method: "POST",
    });
  });

  it("surfaces the safe API error message", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "UPDATE_FAILED",
            message: "Codex konnte nicht aktualisiert werden.",
          },
        },
        { status: 502 },
      ),
    );

    await expect(requestCodexUpdate(fetcher)).rejects.toThrow(
      "Codex konnte nicht aktualisiert werden.",
    );
  });

  it("rejects malformed successful responses", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));

    await expect(fetchCodexUpdateStatus(fetcher)).rejects.toThrow(
      "invalid response",
    );
  });
});
