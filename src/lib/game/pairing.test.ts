import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    gameSession: { findFirst: vi.fn() },
    character: { findMany: vi.fn() },
    sessionMember: { findMany: vi.fn() },
    invite: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const invites = vi.hoisted(() => ({ createInvite: vi.fn() }));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/invite", () => invites);

const session = {
  id: "session-a",
  campaignId: "campaign-a",
  campaign: { hostId: "host-a" },
};

function transactionClient() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    gameSession: { findFirst: vi.fn().mockResolvedValue(session) },
    character: { findFirst: vi.fn() },
    sessionMember: {
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    invite: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("couch pairing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.prisma.gameSession.findFirst.mockResolvedValue(session);
    db.prisma.character.findMany.mockResolvedValue([
      { id: "char-a", name: "Elinor" },
    ]);
    db.prisma.sessionMember.findMany.mockResolvedValue([]);
    db.prisma.invite.findMany.mockResolvedValue([]);
  });

  it("uses a stable, namespaced advisory transaction lock for a seat", async () => {
    const { lockPairingSeat } = await import("./pairing-lock");
    const tx = transactionClient();

    await lockPairingSeat(tx as never, "session-a", "char-a");
    await lockPairingSeat(tx as never, "session-a", "char-a");
    await lockPairingSeat(tx as never, "session-a", "char-b");

    const calls = tx.$executeRaw.mock.calls.map(([query]) => query);
    expect(calls[0].values).toEqual(["couch-pairing:session-a:char-a"]);
    expect(calls[1].values).toEqual(calls[0].values);
    expect(calls[2].values).toEqual(["couch-pairing:session-a:char-b"]);
    expect(calls[0].strings.join(" ")).toContain("pg_advisory_xact_lock");
  });

  it("locks before reading post-lock state, reuses one invite, and revokes duplicates", async () => {
    const { ensurePairingForHost } = await import("./pairing");
    const tx = transactionClient();
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async () => {
      order.push("lock");
      return 1;
    });
    tx.sessionMember.findFirst.mockImplementation(async () => {
      order.push("member");
      return null;
    });
    tx.invite.findMany.mockImplementation(async () => {
      order.push("invites");
      return [
        {
          id: "invite-new",
          code: "new-code",
          expiresAt: new Date("2030-01-02T00:00:00.000Z"),
        },
        {
          id: "invite-old",
          code: "old-code",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        },
      ];
    });
    db.prisma.$transaction.mockImplementation(async (run) => run(tx));

    const result = await ensurePairingForHost("session-a", "host-a");

    expect(order).toEqual(["lock", "member", "invites"]);
    expect(tx.invite.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-old"] } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(invites.createInvite).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionId: "session-a",
      seats: [
        expect.objectContaining({
          characterId: "char-a",
          status: "ready",
          invitePath: "/play/invite/new-code",
        }),
      ],
    });
  });

  it("creates a 12 hour invite when the locked seat has none", async () => {
    const { ensurePairingForHost } = await import("./pairing");
    const tx = transactionClient();
    tx.sessionMember.findFirst.mockResolvedValue(null);
    tx.invite.findMany.mockResolvedValue([]);
    db.prisma.$transaction.mockImplementation(async (run) => run(tx));
    invites.createInvite.mockResolvedValue({
      invite: {
        id: "invite-a",
        code: "fresh-code",
        expiresAt: new Date("2030-01-01T12:00:00.000Z"),
      },
      token: "fresh-code",
      url: "/play/invite/fresh-code",
    });

    const result = await ensurePairingForHost("session-a", "host-a");

    expect(invites.createInvite).toHaveBeenCalledWith(
      {
        campaignId: "campaign-a",
        issuedById: "host-a",
        sessionId: "session-a",
        characterId: "char-a",
        displayName: "Elinor",
        ttlHours: 12,
      },
      tx,
    );
    expect(result?.seats[0].invitePath).toBe("/play/invite/fresh-code");
  });

  it("reads pairing state without minting or mutating invites", async () => {
    const { pairingStateForHost } = await import("./pairing");
    db.prisma.sessionMember.findMany.mockResolvedValue([
      { id: "member-a", characterId: "char-a" },
    ]);

    const result = await pairingStateForHost("session-a", "host-a");

    expect(result?.seats[0]).toEqual(
      expect.objectContaining({ status: "paired", invitePath: null }),
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(invites.createInvite).not.toHaveBeenCalled();
  });

  it("reissues atomically by leaving the member and revoking all old invites", async () => {
    const { reissuePairingForHost } = await import("./pairing");
    const tx = transactionClient();
    tx.character.findFirst.mockResolvedValue({ id: "char-a", name: "Elinor" });
    tx.invite.findMany.mockResolvedValue([]);
    db.prisma.$transaction.mockImplementation(async (run) => run(tx));
    invites.createInvite.mockResolvedValue({
      invite: {
        id: "invite-fresh",
        code: "fresh-code",
        expiresAt: new Date("2030-01-01T12:00:00.000Z"),
      },
      token: "fresh-code",
      url: "/play/invite/fresh-code",
    });

    const result = await reissuePairingForHost(
      "session-a",
      "host-a",
      "char-a",
    );

    expect(tx.sessionMember.updateMany).toHaveBeenCalledWith({
      where: { sessionId: "session-a", characterId: "char-a", leftAt: null },
      data: { leftAt: expect.any(Date) },
    });
    expect(tx.invite.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session-a",
        characterId: "char-a",
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toEqual(
      expect.objectContaining({
        characterId: "char-a",
        status: "ready",
        invitePath: "/play/invite/fresh-code",
      }),
    );
  });

  it("returns null when the session is not owned by the host", async () => {
    const { ensurePairingForHost } = await import("./pairing");
    db.prisma.gameSession.findFirst.mockResolvedValue(null);

    await expect(
      ensurePairingForHost("session-a", "not-the-host"),
    ).resolves.toBeNull();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });
});
