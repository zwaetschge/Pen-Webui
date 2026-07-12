import { describe, expect, it } from "vitest";
import { castGuideForUserAgent } from "./CastGuideDialog";

describe("castGuideForUserAgent", () => {
  it("guides desktop Chrome users through tab casting", () => {
    const guide = castGuideForUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149.0 Safari/537.36",
    );

    expect(guide.platform).toBe("desktop");
    expect(guide.steps.join(" ")).toContain("Chrome-Menü");
    expect(guide.steps.join(" ")).toContain("Tab streamen");
  });

  it("uses Google Home screen mirroring on Android", () => {
    const guide = castGuideForUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/149.0 Mobile Safari/537.36",
    );

    expect(guide.platform).toBe("android");
    expect(guide.steps.join(" ")).toContain("Google Home");
    expect(guide.steps.join(" ")).toContain("Bildschirm streamen");
  });

  it("explains the supported fallback on iPhone and iPad", () => {
    const guide = castGuideForUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
    );

    expect(guide.platform).toBe("ios");
    expect(guide.steps.join(" ")).toContain("Desktop-Chrome");
  });
});
