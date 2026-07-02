import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  env: vi.fn(() => ({ VOCARIUM_API_URL: "http://vocarium.test" })),
}));

vi.mock("@/lib/env", () => envMock);

describe("vocarium client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists clone voices with the campaign host as Remote-User", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: "83b59aca",
              name: "Michael Scott",
              language: "German",
              source: "clone",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { listCloneVoices } = await import("./vocarium-client");
    const voices = await listCloneVoices("zwaetschge");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vocarium.test/v1/voices?source=clone",
      expect.objectContaining({
        headers: expect.objectContaining({ "Remote-User": "zwaetschge" }),
      }),
    );
    expect(voices).toEqual([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
  });

  it("synthesizes clone speech through /v1/audio/speech", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    );

    const { synthesizeCloneSpeech } = await import("./vocarium-client");
    const audio = await synthesizeCloneSpeech({
      vocariumUser: "zwaetschge",
      voiceId: "2abffe14",
      text: "Kurzer Test.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vocarium.test/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Remote-User": "zwaetschge",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "tts-1",
          input: "Kurzer Test.",
          voice: "2abffe14",
          response_format: "wav",
        }),
      }),
    );
    expect(audio).toEqual({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
  });
});
