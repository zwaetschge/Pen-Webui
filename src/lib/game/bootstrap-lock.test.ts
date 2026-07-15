import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({ eval: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  acquireBootstrapLock,
  BOOTSTRAP_LOCK_TTL_MS,
  releaseBootstrapLock,
} from "./bootstrap-lock";

describe("session bootstrap lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    redisMock.eval.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("acquires one finite per-session lease", async () => {
    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const lock = await acquireBootstrapLock("session-1");

    expect(lock).not.toBeNull();
    expect(redisMock.eval.mock.calls[0]?.[0]).toContain("'NX'");
    expect(redisMock.eval.mock.calls[0]?.[2]).toBe(
      "session:session-1:bootstrap-lock",
    );
    expect(redisMock.eval.mock.calls[0]?.[4]).toBe(
      String(BOOTSTRAP_LOCK_TTL_MS),
    );
    await releaseBootstrapLock(lock!);
    expect(redisMock.eval.mock.calls[1]?.[0]).toContain(
      "redis.call('GET', KEYS[1]) == ARGV[1]",
    );
  });

  it("returns null when another reconnect owns the bootstrap lease", async () => {
    redisMock.eval.mockResolvedValueOnce(0);

    await expect(acquireBootstrapLock("session-1")).resolves.toBeNull();
  });

  it("fails closed when Redis rejects the acquisition", async () => {
    redisMock.eval.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(acquireBootstrapLock("session-1")).resolves.toBeNull();
  });
});
