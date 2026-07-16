import { describe, expect, it } from "vitest";
import {
  shouldAutoAdvanceIntro,
  shouldNotifyIntroComplete,
} from "./IntroDirector";

describe("shouldAutoAdvanceIntro", () => {
  it("keeps the read-only TV intro moving under reduced motion", () => {
    expect(
      shouldAutoAdvanceIntro({
        visible: true,
        reducedMotion: true,
        displayMode: true,
        chapterCount: 4,
      }),
    ).toBe(true);
  });

  it("lets reduced-motion users advance the interactive host intro manually", () => {
    expect(
      shouldAutoAdvanceIntro({
        visible: true,
        reducedMotion: true,
        displayMode: false,
        chapterCount: 4,
      }),
    ).toBe(false);
  });
});

describe("shouldNotifyIntroComplete", () => {
  it("restores the post-intro controls once when the intro was already played", () => {
    expect(
      shouldNotifyIntroComplete({
        wasPlayed: true,
        storageKey: "plum:intro:session-a",
        notifiedKey: null,
      }),
    ).toBe(true);
    expect(
      shouldNotifyIntroComplete({
        wasPlayed: true,
        storageKey: "plum:intro:session-a",
        notifiedKey: "plum:intro:session-a",
      }),
    ).toBe(false);
  });

  it("waits for an unplayed intro to finish", () => {
    expect(
      shouldNotifyIntroComplete({
        wasPlayed: false,
        storageKey: "plum:intro:session-a",
        notifiedKey: null,
      }),
    ).toBe(false);
  });
});
