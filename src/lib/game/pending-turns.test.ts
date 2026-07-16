import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  acknowledgePendingTurn,
  claimPendingTurn,
  enqueuePendingTurn,
  PENDING_TURN_PER_ACTOR_LIMIT,
  PENDING_TURN_QUEUE_LIMIT,
  PendingTurnQueueError,
} from "./pending-turns";

const input = {
  campaignId: "camp_1",
  runnerId: "host_1",
  text: "Ich untersuche die Hintertür.",
  actor: {
    displayName: "Elinor Hale",
    dbActorId: "user_1",
    eventActorId: "member_1",
    characterId: "char_1",
    actorKind: "player" as const,
  },
};

describe("pending exploration turns", () => {
  beforeEach(() => {
    redisMock.eval.mockReset();
  });

  it("returns the FIFO position assigned atomically by Redis", async () => {
    redisMock.eval.mockResolvedValue([1, 3]);

    await expect(enqueuePendingTurn("sess_1", input)).resolves.toEqual({
      accepted: true,
      position: 3,
    });

    const [script, keyCount, pendingKey, processingKey, payload, limit] =
      redisMock.eval.mock.calls[0]!;
    expect(script).toContain("LPUSH");
    expect(script).toContain("LLEN");
    expect(keyCount).toBe(2);
    expect(pendingKey).toBe("dm-turn:sess_1:pending");
    expect(processingKey).toBe("dm-turn:sess_1:processing");
    expect(JSON.parse(payload)).toMatchObject({
      version: 1,
      queueActorKey: "character:char_1",
      campaignId: "camp_1",
      runnerId: "host_1",
      text: input.text,
      actor: input.actor,
    });
    expect(limit).toBe(String(PENDING_TURN_QUEUE_LIMIT));
    expect(redisMock.eval.mock.calls[0]?.[7]).toBe(
      String(PENDING_TURN_PER_ACTOR_LIMIT),
    );
    expect(script).toContain("cjson.decode");
    expect(script).toContain("LRANGE");
  });

  it("reports a full queue without accepting another action", async () => {
    redisMock.eval.mockResolvedValue([-1, PENDING_TURN_QUEUE_LIMIT]);

    await expect(enqueuePendingTurn("sess_1", input)).resolves.toEqual({
      accepted: false,
      reason: "queue_full",
      size: PENDING_TURN_QUEUE_LIMIT,
      limit: PENDING_TURN_QUEUE_LIMIT,
    });
  });

  it("enforces the per-character queue limit atomically", async () => {
    redisMock.eval.mockResolvedValue([-2, 7, PENDING_TURN_PER_ACTOR_LIMIT]);

    await expect(enqueuePendingTurn("sess_1", input)).resolves.toEqual({
      accepted: false,
      reason: "actor_limit",
      size: 7,
      actorSize: PENDING_TURN_PER_ACTOR_LIMIT,
      limit: PENDING_TURN_PER_ACTOR_LIMIT,
    });
  });

  it("discards corrupt queue data and returns the next valid FIFO item", async () => {
    const valid = JSON.stringify({
      version: 1,
      queueActorKey: "character:char_1",
      id: "queued_1",
      enqueuedAt: 1_700_000_000_000,
      ...input,
    });
    redisMock.eval
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(valid);

    await expect(claimPendingTurn("sess_1")).resolves.toEqual({
      receipt: valid,
      turn: JSON.parse(valid),
    });
    expect(redisMock.eval).toHaveBeenCalledTimes(3);
  });

  it("acknowledges the exact claimed receipt", async () => {
    redisMock.eval.mockResolvedValue(1);

    await expect(
      acknowledgePendingTurn("sess_1", "encoded-turn"),
    ).resolves.toBeUndefined();
    expect(redisMock.eval.mock.calls[0]?.slice(2, 5)).toEqual([
      "dm-turn:sess_1:pending",
      "dm-turn:sess_1:processing",
      "encoded-turn",
    ]);
  });

  it("retries an ambiguous acknowledgement idempotently", async () => {
    redisMock.eval
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(0);

    await expect(
      acknowledgePendingTurn("sess_1", "encoded-turn"),
    ).resolves.toBeUndefined();
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
  });

  it("maps Redis failures to a stable queue-unavailable error", async () => {
    redisMock.eval.mockRejectedValue(new Error("redis down"));

    const result = enqueuePendingTurn("sess_1", input);
    await expect(result).rejects.toBeInstanceOf(PendingTurnQueueError);
    await expect(result).rejects.toMatchObject({ code: "unavailable" });
  });
});
