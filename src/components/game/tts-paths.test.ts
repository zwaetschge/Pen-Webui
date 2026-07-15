import { describe, expect, it } from "vitest";
import { ttsPostPath } from "./tts-paths";
import { isTtsExperienceEnabled } from "./TtsProvider";

describe("ttsPostPath", () => {
  it("uses the authenticated session endpoint", () => {
    expect(ttsPostPath("sess_1")).toBe("/api/sessions/sess_1/tts");
  });

  it("uses the invite endpoint when an invite token exists", () => {
    expect(
      ttsPostPath("sess_1", { kind: "invite", token: "tok/with spaces" }),
    ).toBe("/api/invite/sessions/sess_1/tts/tok%2Fwith%20spaces");
  });

  it("uses the read-only display endpoint for the TV capability", () => {
    expect(ttsPostPath("sess_1", { kind: "display", token: "tv token" })).toBe(
      "/api/display/sessions/sess_1/tts/tv%20token",
    );
  });
});

describe("shared-screen audio ownership", () => {
  it("enables TTS for the local table and the TV display", () => {
    expect(isTtsExperienceEnabled("table")).toBe(true);
    expect(isTtsExperienceEnabled("display")).toBe(true);
    expect(isTtsExperienceEnabled("companion")).toBe(false);
  });
});
