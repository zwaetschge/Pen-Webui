import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  campaignFindUnique: vi.fn(),
  voiceAssignmentFindMany: vi.fn(),
  voiceAssignmentUpsert: vi.fn(),
  characterFindFirst: vi.fn(),
}));

const authMock = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const accessMock = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const inviteTokenMock = vi.hoisted(() => ({ parseToken: vi.fn() }));
const vocariumMock = vi.hoisted(() => ({ listCloneVoices: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: { findUnique: db.campaignFindUnique },
    voiceAssignment: {
      findMany: db.voiceAssignmentFindMany,
      upsert: db.voiceAssignmentUpsert,
    },
    character: { findFirst: db.characterFindFirst },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: authMock.getSessionUser,
}));

vi.mock("@/lib/game/access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("@/lib/invite-token", () => ({
  parseToken: inviteTokenMock.parseToken,
}));

vi.mock("./vocarium-client", () => ({
  listCloneVoices: vocariumMock.listCloneVoices,
}));

function getRequest(url: string) {
  return new Request(url);
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("campaign voice APIs", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(db).forEach((mock) => mock.mockReset());
    authMock.getSessionUser.mockReset();
    accessMock.resolveAccess.mockReset();
    inviteTokenMock.parseToken.mockReset();
    vocariumMock.listCloneVoices.mockReset();
  });

  it("lists clone voices using the campaign host username", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({
      id: "host_1",
      username: "zwaetschge",
    });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);

    const { handleCampaignVoices } = await import("./campaign-api");
    const response = await handleCampaignVoices(
      getRequest("http://app/api/campaigns/camp_1/voices"),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      voices: [
        {
          voiceId: "83b59aca",
          name: "Michael Scott",
          language: "German",
          source: "clone",
        },
      ],
    });
    expect(vocariumMock.listCloneVoices).toHaveBeenCalledWith("zwaetschge");
  });

  it("lets the host assign narrator and NPC voices", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({
      id: "host_1",
      username: "zwaetschge",
    });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "2abffe14",
        name: "Maurice Moss",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
    db.voiceAssignmentUpsert.mockResolvedValue({
      id: "va_1",
      campaignId: "camp_1",
      targetType: "npc",
      targetId: "npc_moss",
      voiceId: "2abffe14",
      voiceName: "Maurice Moss",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
    });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          { targetType: "npc", targetId: "npc_moss", voiceId: "2abffe14" },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assignments: [
        {
          id: "va_1",
          campaignId: "camp_1",
          targetType: "npc",
          targetId: "npc_moss",
          voiceId: "2abffe14",
          voiceName: "Maurice Moss",
          voiceSource: "clone",
        },
      ],
    });
    expect(db.voiceAssignmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId_targetType_targetId: {
            campaignId: "camp_1",
            targetType: "npc",
            targetId: "npc_moss",
          },
        },
        create: expect.objectContaining({
          vocariumUser: "zwaetschge",
          voiceName: "Maurice Moss",
          voiceSource: "clone",
        }),
      }),
    );
  });

  it("omits vocariumUser from assignment reads", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({
      id: "host_1",
      username: "zwaetschge",
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        id: "va_1",
        targetType: "npc",
        targetId: "npc_moss",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);

    const { handleGetVoiceAssignments } = await import("./campaign-api");
    const response = await handleGetVoiceAssignments(
      getRequest("http://app/api/campaigns/camp_1/voice-assignments"),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assignments: [
        {
          id: "va_1",
          targetType: "npc",
          targetId: "npc_moss",
          voiceId: "2abffe14",
          voiceName: "Maurice Moss",
          voiceSource: "clone",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    expect(db.voiceAssignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "camp_1", vocariumUser: "zwaetschge" },
        select: expect.not.objectContaining({
          vocariumUser: true,
        }),
      }),
    );
  });

  it("returns only the caller's own character assignment for player reads under the host tenant", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "player_1", username: "player" });
    db.characterFindFirst.mockResolvedValue({ id: "char_robert" });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        id: "va_2",
        targetType: "character",
        targetId: "char_robert",
        voiceId: "83b59aca",
        voiceName: "Michael Scott",
        voiceSource: "clone",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);

    const { handleGetVoiceAssignments } = await import("./campaign-api");
    const response = await handleGetVoiceAssignments(
      getRequest("http://app/api/campaigns/camp_1/voice-assignments"),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assignments: [
        {
          id: "va_2",
          targetType: "character",
          targetId: "char_robert",
          voiceId: "83b59aca",
          voiceName: "Michael Scott",
          voiceSource: "clone",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    expect(db.voiceAssignmentFindMany).toHaveBeenCalledWith({
      where: {
        campaignId: "camp_1",
        vocariumUser: "zwaetschge",
        targetType: "character",
        targetId: "char_robert",
      },
      orderBy: [{ targetType: "asc" }, { targetId: "asc" }],
      select: {
        id: true,
        targetType: true,
        targetId: true,
        voiceId: true,
        voiceName: true,
        voiceSource: true,
        updatedAt: true,
      },
    });
  });

  it("lets a player assign only their own character voice", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "player_1", username: "player" });
    db.characterFindFirst.mockResolvedValue({ id: "char_robert" });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
    db.voiceAssignmentUpsert.mockResolvedValue({
      id: "va_2",
      campaignId: "camp_1",
      targetType: "character",
      targetId: "char_robert",
      voiceId: "83b59aca",
      voiceName: "Michael Scott",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
    });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          {
            targetType: "character",
            targetId: "char_robert",
            voiceId: "83b59aca",
          },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(200);
  });

  it("blocks a player assigning an NPC voice", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "player_1", username: "player" });
    db.characterFindFirst.mockResolvedValue({ id: "char_robert" });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          { targetType: "npc", targetId: "npc_moss", voiceId: "2abffe14" },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(403);
  });

  it("rejects invite voice reads when the signed path token does not match the guest invite", async () => {
    inviteTokenMock.parseToken.mockReturnValue({
      inviteId: "inv_path",
      expiryUnix: Math.floor(Date.now() / 1000) + 300,
    });
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: null,
      displayName: "Guest",
      memberId: "member_1",
      characterId: null,
      inviteId: "inv_cookie",
    });

    const { handleInviteSessionVoices } = await import("./campaign-api");
    const response = await handleInviteSessionVoices(
      getRequest("http://app/api/invite/sessions/sess_1/voices/token"),
      "sess_1",
      "signed-token",
    );

    expect(response.status).toBe(403);
    expect(accessMock.resolveAccess).toHaveBeenCalledWith({ sessionId: "sess_1" });
    expect(vocariumMock.listCloneVoices).not.toHaveBeenCalled();
  });

  it("rejects invite assignment reads when the signed path token does not match the guest invite", async () => {
    inviteTokenMock.parseToken.mockReturnValue({
      inviteId: "inv_path",
      expiryUnix: Math.floor(Date.now() / 1000) + 300,
    });
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: null,
      displayName: "Guest",
      memberId: "member_1",
      characterId: null,
      inviteId: "inv_cookie",
    });

    const { handleInviteSessionVoiceAssignments } = await import("./campaign-api");
    const response = await handleInviteSessionVoiceAssignments(
      getRequest("http://app/api/invite/sessions/sess_1/voice-assignments/token"),
      "sess_1",
      "signed-token",
    );

    expect(response.status).toBe(403);
    expect(accessMock.resolveAccess).toHaveBeenCalledWith({ sessionId: "sess_1" });
    expect(db.voiceAssignmentFindMany).not.toHaveBeenCalled();
  });

  it("rejects invite voice and assignment reads from authenticated non-guest access", async () => {
    inviteTokenMock.parseToken.mockReturnValue({
      inviteId: "inv_path",
      expiryUnix: Math.floor(Date.now() / 1000) + 300,
    });
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "player_1",
      displayName: "Player",
      memberId: "member_1",
      characterId: "char_robert",
      inviteId: null,
    });

    const {
      handleInviteSessionVoices,
      handleInviteSessionVoiceAssignments,
    } = await import("./campaign-api");

    const voicesResponse = await handleInviteSessionVoices(
      getRequest("http://app/api/invite/sessions/sess_1/voices/token"),
      "sess_1",
      "signed-token",
    );
    const assignmentsResponse = await handleInviteSessionVoiceAssignments(
      getRequest("http://app/api/invite/sessions/sess_1/voice-assignments/token"),
      "sess_1",
      "signed-token",
    );

    expect(voicesResponse.status).toBe(403);
    expect(assignmentsResponse.status).toBe(403);
    expect(accessMock.resolveAccess).toHaveBeenCalledTimes(2);
    expect(vocariumMock.listCloneVoices).not.toHaveBeenCalled();
    expect(db.voiceAssignmentFindMany).not.toHaveBeenCalled();
  });
});
