import { describe, expect, it } from "vitest";
import { buildDisplayToken, parseDisplayToken } from "./display-token";

const secret = "test-secret-with-at-least-sixteen-characters";
const now = 1_800_000_000;

describe("display capability tokens", () => {
  it("round-trips a read-only display capability", () => {
    const token = buildDisplayToken(
      {
        sessionId: "session-a",
        capabilityId: "capability-a",
        expiryUnix: now + 3600,
      },
      secret,
    );

    expect(parseDisplayToken(token, secret, { nowUnix: now })).toEqual({
      version: 2,
      audience: "plum-display",
      sessionId: "session-a",
      capabilityId: "capability-a",
      expiryUnix: now + 3600,
    });
  });

  it("rejects tampering, expiry, and use for a different session", () => {
    const token = buildDisplayToken(
      {
        sessionId: "session-a",
        capabilityId: "capability-a",
        expiryUnix: now + 60,
      },
      secret,
    );

    expect(parseDisplayToken(`${token}x`, secret, { nowUnix: now })).toBeNull();
    expect(parseDisplayToken(token, secret, { nowUnix: now + 61 })).toBeNull();
    expect(
      parseDisplayToken(token, secret, { nowUnix: now })?.sessionId,
    ).not.toBe("session-b");
  });

  it("rejects malformed and oversized tokens without throwing", () => {
    expect(
      parseDisplayToken("not-a-token", secret, { nowUnix: now }),
    ).toBeNull();
    expect(
      parseDisplayToken("x".repeat(4096), secret, { nowUnix: now }),
    ).toBeNull();
  });
});
