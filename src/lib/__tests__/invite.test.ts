import { describe, it, expect, beforeAll } from "vitest";
import {
  buildGuestCredential,
  guestCookieName,
  parseGuestCredential,
} from "../guest-credential";
import { buildToken, parseToken } from "../invite-token";

beforeAll(() => {
  process.env.INVITE_HMAC_SECRET = "test-secret-test-secret-test-secret";
});

describe("invite token", () => {
  it("has three dot-separated parts", () => {
    const t = buildToken("inv_abc123", new Date(Date.now() + 3600_000));
    expect(t.split(".").length).toBe(3);
  });

  it("is deterministic for fixed inputs", () => {
    const exp = new Date(2030, 0, 1, 0, 0, 0);
    const a = buildToken("inv_abc", exp);
    const b = buildToken("inv_abc", exp);
    expect(a).toBe(b);
  });

  it("changes when expiry changes", () => {
    const a = buildToken("inv_abc", new Date(Date.now() + 1000));
    const b = buildToken("inv_abc", new Date(Date.now() + 2000));
    expect(a).not.toBe(b);
  });

  it("rejects oversized token input before decoding", () => {
    expect(parseToken("x".repeat(513))).toBeNull();
  });
});

describe("guest credential", () => {
  it("round-trips a session-bound guest member", () => {
    const token = buildGuestCredential({
      sessionId: "sess_1",
      memberId: "member_1",
      inviteId: "inv_1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    expect(guestCookieName("sess_1")).toBe("plum_guest_sess_1");
    expect(parseGuestCredential(token)).toMatchObject({
      sessionId: "sess_1",
      memberId: "member_1",
      inviteId: "inv_1",
    });
  });

  it("rejects tampered credentials", () => {
    const token = buildGuestCredential({
      sessionId: "sess_1",
      memberId: "member_1",
      inviteId: "inv_1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(parseGuestCredential(tampered)).toBeNull();
  });
});
