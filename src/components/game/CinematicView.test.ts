import { describe, expect, it } from "vitest";
import {
  cinematicFallbackClassName,
  cinematicDialogueBoxClassName,
  cinematicDialogueTextClassName,
  cinematicLocationClassName,
  showCinematicAudioControls,
} from "./CinematicView";

describe("showCinematicAudioControls", () => {
  it("keeps playback controls off the read-only TV stage", () => {
    expect(showCinematicAudioControls(true, true)).toBe(false);
  });

  it("keeps playback controls available on the host stage", () => {
    expect(showCinematicAudioControls(true, false)).toBe(true);
  });
});

describe("display dialogue layout", () => {
  it("uses TV-safe width and typography without handheld utility overrides", () => {
    const box = cinematicDialogueBoxClassName(true);
    const text = cinematicDialogueTextClassName(true, "narrator");

    expect(box).toContain("display-dialogue-box");
    expect(box).not.toContain("max-w-[82rem]");
    expect(text).toContain("display-dialogue-text");
    expect(text).not.toContain("text-lg");
  });
});

describe("cinematicLocationClassName", () => {
  it("does not let small-screen offsets override the TV safe area", () => {
    const className = cinematicLocationClassName(true);

    expect(className).toContain("display-location-card");
    expect(className).not.toContain("top-4");
    expect(className).not.toContain("sm:top-6");
  });
});

describe("cinematic fallback", () => {
  it("uses a visible TV-specific fallback when no scene image is ready", () => {
    expect(cinematicFallbackClassName(true)).toContain(
      "display-scene-fallback",
    );
    expect(cinematicFallbackClassName(false)).not.toContain(
      "display-scene-fallback",
    );
  });
});
