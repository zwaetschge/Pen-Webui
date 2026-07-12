import { beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.hoisted(() => ({
  handleSessionTtsAudio: vi.fn(),
}));

vi.mock("@/lib/tts/session-api", () => tts);

describe("invite TTS audio route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tts.handleSessionTtsAudio.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
  });

  it("delegates the scoped identifiers and invite capability to the audio handler", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://app/audio");

    const response = await GET(request, {
      params: Promise.resolve({
        id: "session-a",
        cacheId: "cache-a",
        token: "invite-a",
      }),
    });

    expect(response.status).toBe(200);
    expect(tts.handleSessionTtsAudio).toHaveBeenCalledWith(
      request,
      "session-a",
      "cache-a",
      "invite-a",
    );
  });

  it("uses the Node runtime without static route caching", async () => {
    const route = await import("./route");

    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });
});
