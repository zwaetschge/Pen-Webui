import { describe, expect, it } from "vitest";
import { shouldAutoAdvanceIntro } from "./IntroDirector";

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
