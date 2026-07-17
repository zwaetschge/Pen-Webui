import { describe, expect, it } from "vitest";
import {
  gameplayConsoleMode,
  isHostConsoleAvailable,
  sharedStageView,
} from "./session-progression";

describe("session progression controls", () => {
  it("keeps the host table actionable after the cinematic intro", () => {
    expect(gameplayConsoleMode({ experience: "table", role: "host" })).toBe(
      "drawer",
    );
  });

  it("keeps companion controls inline and the cast display read-only", () => {
    expect(
      gameplayConsoleMode({ experience: "companion", role: "player" }),
    ).toBe("inline");
    expect(
      gameplayConsoleMode({ experience: "display", role: "player" }),
    ).toBeNull();
  });

  it("keeps the host drawer below terminal game-state overlays", () => {
    expect(
      isHostConsoleAvailable({
        mode: "drawer",
        gameOver: false,
        sessionEnded: false,
      }),
    ).toBe(true);
    expect(
      isHostConsoleAvailable({
        mode: "drawer",
        gameOver: true,
        sessionEnded: false,
      }),
    ).toBe(false);
    expect(
      isHostConsoleAvailable({
        mode: "drawer",
        gameOver: false,
        sessionEnded: true,
      }),
    ).toBe(false);
  });

  it("uses the interactive map as the shared-screen default", () => {
    expect(
      sharedStageView({
        combatActive: false,
        presentationMode: null,
      }),
    ).toBe("map");
  });

  it.each(["dialogue", "cutscene"] as const)(
    "shows %s cues cinematically outside combat",
    (presentationMode) => {
      expect(
        sharedStageView({
          combatActive: false,
          presentationMode,
        }),
      ).toBe("cinematic");
    },
  );

  it("always prioritizes combat over a cinematic cue", () => {
    expect(
      sharedStageView({
        combatActive: true,
        presentationMode: "cutscene",
      }),
    ).toBe("map");
  });
});
