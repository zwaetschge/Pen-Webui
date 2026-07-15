import { describe, expect, it, vi } from "vitest";
import {
  castAgentAuthToken,
  createCastAgentClient,
  type CastAgentTransport,
} from "./agent-client";

const secret = "test-secret-with-at-least-sixteen-characters";

describe("cast agent client", () => {
  it("derives a domain-separated bearer token instead of sending the HMAC secret", () => {
    const token = castAgentAuthToken(secret);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(secret);
  });

  it("lists validated devices over the configured Unix socket", async () => {
    const transport = vi.fn<CastAgentTransport>().mockResolvedValue({
      devices: [
        {
          id: "cast-a",
          name: "Wohnzimmer",
          model: "Chromecast",
          online: true,
          activeSessionId: null,
        },
      ],
    });
    const client = createCastAgentClient({
      socketPath: "/run/plum-cast/agent.sock",
      secret,
      transport,
    });

    await expect(client.listDevices()).resolves.toEqual([
      expect.objectContaining({ id: "cast-a", name: "Wohnzimmer" }),
    ]);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: "/run/plum-cast/agent.sock",
        method: "GET",
        path: "/v1/devices",
        authToken: castAgentAuthToken(secret),
      }),
    );
  });

  it("sends only a server-created display URL and session identifier", async () => {
    const transport = vi.fn<CastAgentTransport>().mockResolvedValue({
      cast: {
        state: "starting",
        deviceId: "cast-a",
        deviceName: "Wohnzimmer",
        sessionId: "session-a",
      },
    });
    const client = createCastAgentClient({
      socketPath: "/run/plum-cast/agent.sock",
      secret,
      transport,
    });

    await client.startCast({
      sessionId: "session-a",
      deviceId: "cast-a",
      url: "https://table.example/display/sessions/session-a/token",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/casts",
        body: {
          sessionId: "session-a",
          deviceId: "cast-a",
          url: "https://table.example/display/sessions/session-a/token",
        },
      }),
    );
  });

  it("fails closed when the agent returns an invalid response", async () => {
    const client = createCastAgentClient({
      socketPath: "/run/plum-cast/agent.sock",
      secret,
      transport: vi
        .fn<CastAgentTransport>()
        .mockResolvedValue({ devices: [{}] }),
    });

    await expect(client.listDevices()).rejects.toThrow("invalid_response");
  });
});
