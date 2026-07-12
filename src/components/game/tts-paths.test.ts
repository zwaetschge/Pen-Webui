import { describe, expect, it } from "vitest";
import { ttsPostPath } from "./tts-paths";
import { isTtsExperienceEnabled } from "./TtsProvider";

describe("ttsPostPath", () => {
  it("uses the authenticated session endpoint", () => {
    expect(ttsPostPath("sess_1")).toBe("/api/sessions/sess_1/tts");
  });

  it("uses the invite endpoint when an invite token exists", () => {
    expect(ttsPostPath("sess_1", "tok/with spaces")).toBe(
      "/api/invite/sessions/sess_1/tts/tok%2Fwith%20spaces",
    );
  });
});

describe("table audio ownership", () => {
  it("enables TTS only for the shared table experience", () => {
    expect(isTtsExperienceEnabled("table")).toBe(true);
    expect(isTtsExperienceEnabled("companion")).toBe(false);
  });
});
