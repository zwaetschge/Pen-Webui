import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  del: vi.fn(),
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  activateDisplayCapability,
  consumeDisplayTtsBudget,
  isDisplayCapabilityActive,
  resolveActiveDisplayCapability,
  revokeDisplayCapability,
} from "./display-capability";
import { buildDisplayToken, type DisplayTokenClaims } from "./display-token";

const secret = "test-secret-with-at-least-sixteen-characters";
const now = 1_800_000_000;
const claims: DisplayTokenClaims = {
  version: 2,
  audience: "plum-display",
  sessionId: "session-a",
  capabilityId: "capability-a",
  expiryUnix: now + 60,
};

describe("active display capabilities", () => {
  beforeEach(() => {
    Object.values(redisMock).forEach((mock) => mock.mockReset());
  });

  it("activates exactly one expiring capability per session", async () => {
    redisMock.set.mockResolvedValue("OK");

    await activateDisplayCapability(claims, { nowUnix: now });

    expect(redisMock.set).toHaveBeenCalledWith(
      "display-capability:session-a",
      "capability-a",
      "PX",
      60_000,
    );
  });

  it("accepts a signed token only while its capability remains active", async () => {
    const token = buildDisplayToken(
      {
        sessionId: claims.sessionId,
        capabilityId: claims.capabilityId,
        expiryUnix: claims.expiryUnix,
      },
      secret,
    );
    redisMock.get.mockResolvedValueOnce("capability-a");

    await expect(
      resolveActiveDisplayCapability(token, "session-a", secret, {
        nowUnix: now,
      }),
    ).resolves.toEqual(claims);

    redisMock.get.mockResolvedValueOnce("rotated-capability");
    await expect(
      resolveActiveDisplayCapability(token, "session-a", secret, {
        nowUnix: now,
      }),
    ).resolves.toBeNull();
  });

  it("checks and revokes the active record without reviving stale tokens", async () => {
    redisMock.get.mockResolvedValueOnce("capability-a");
    redisMock.eval.mockResolvedValueOnce(1);
    redisMock.del.mockResolvedValueOnce(1);

    await expect(isDisplayCapabilityActive(claims)).resolves.toBe(true);
    await expect(
      revokeDisplayCapability("session-a", "capability-a"),
    ).resolves.toBe(true);
    await expect(revokeDisplayCapability("session-a")).resolves.toBe(true);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      "display-capability:session-a",
      "capability-a",
    );
    expect(redisMock.del).toHaveBeenCalledWith("display-capability:session-a");
  });

  it("atomically bounds display-triggered TTS cache misses", async () => {
    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(consumeDisplayTtsBudget(claims)).resolves.toBe(true);
    await expect(consumeDisplayTtsBudget(claims)).resolves.toBe(false);

    expect(redisMock.eval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INCR"),
      1,
      "display-tts:session-a:capability-a",
      expect.any(String),
      expect.any(String),
    );
  });
});
