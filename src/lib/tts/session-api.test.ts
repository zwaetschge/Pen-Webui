import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  eventLogFindFirst: vi.fn(),
  voiceAssignmentFindMany: vi.fn(),
  ttsAudioCacheFindFirst: vi.fn(),
  ttsAudioCacheCreate: vi.fn(),
}));

const accessMock = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const inviteTokenMock = vi.hoisted(() => ({ parseToken: vi.fn() }));
const vocariumMock = vi.hoisted(() => ({ synthesizeCloneSpeech: vi.fn() }));
const displayCapabilityMock = vi.hoisted(() => ({
  consumeDisplayTtsBudget: vi.fn(),
  resolveActiveDisplayCapability: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: { findUnique: db.gameSessionFindUnique },
    eventLog: { findFirst: db.eventLogFindFirst },
    voiceAssignment: { findMany: db.voiceAssignmentFindMany },
    ttsAudioCache: {
      findFirst: db.ttsAudioCacheFindFirst,
      create: db.ttsAudioCacheCreate,
    },
  },
}));

vi.mock("@/lib/game/access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("@/lib/invite-token", () => ({
  parseToken: inviteTokenMock.parseToken,
}));

vi.mock("@/lib/cast/display-capability", () => displayCapabilityMock);

vi.mock("@/lib/env", () => ({
  env: () => ({
    INVITE_HMAC_SECRET: "test-secret-with-at-least-sixteen-characters",
  }),
}));

vi.mock("./vocarium-client", () => ({
  synthesizeCloneSpeech: vocariumMock.synthesizeCloneSpeech,
}));

function post(eventId: string) {
  return new Request("http://app/api/sessions/sess_1/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId }),
  });
}

function get(cacheId = "cache_1") {
  return new Request(`http://app/api/sessions/sess_1/tts/${cacheId}`);
}

describe("session TTS API", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(db).forEach((mock) => mock.mockReset());
    accessMock.resolveAccess.mockReset();
    inviteTokenMock.parseToken.mockReset();
    vocariumMock.synthesizeCloneSpeech.mockReset();
    Object.values(displayCapabilityMock).forEach((mock) => mock.mockReset());
  });

  it("returns cached audio without calling Vocarium", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      id: "cache_1",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 12,
      voiceId: "2abffe14",
      error: null,
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      cacheId: "cache_1",
      audioUrl: "/api/sessions/sess_1/tts/cache_1",
      mimeType: "audio/wav",
      byteLength: 12,
      voice: {
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    });
    expect(body.voice).not.toHaveProperty("vocariumUser");
    expect(vocariumMock.synthesizeCloneSpeech).not.toHaveBeenCalled();
  });

  it("generates audio with the campaign host tenant and stores bytes", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);
    vocariumMock.synthesizeCloneSpeech.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
    db.ttsAudioCacheCreate.mockResolvedValue({
      id: "cache_new",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 3,
      voiceId: "2abffe14",
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");

    expect(response.status).toBe(200);
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledWith({
      vocariumUser: "zwaetschge",
      voiceId: "2abffe14",
      text: "Hallo.",
    });
    expect(db.ttsAudioCacheCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "sess_1",
          eventId: "ev_1",
          voiceId: "2abffe14",
          audio: Buffer.from([1, 2, 3]),
          mimeType: "audio/wav",
          byteLength: 3,
          status: "ready",
        }),
      }),
    );
  });

  it("ignores foreign-tenant assignments and falls back under the host tenant", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);
    vocariumMock.synthesizeCloneSpeech.mockResolvedValue({
      bytes: Buffer.from([4, 5, 6]),
      mimeType: "audio/wav",
    });
    db.ttsAudioCacheCreate.mockResolvedValue({
      id: "cache_default",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 3,
      voiceId: "default",
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.voiceAssignmentFindMany).toHaveBeenCalledWith({
      where: {
        campaignId: "camp_1",
        vocariumUser: "zwaetschge",
        OR: [
          { targetType: "npc", targetId: "npc_moss" },
          { targetType: "narrator", targetId: "narrator" },
        ],
      },
      select: {
        targetType: true,
        targetId: true,
        vocariumUser: true,
        voiceId: true,
        voiceName: true,
        voiceSource: true,
      },
    });
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledWith({
      vocariumUser: "zwaetschge",
      voiceId: "default",
      text: "Hallo.",
    });
    expect(body.voice).toMatchObject({
      voiceId: "default",
      voiceName: "Default",
      voiceSource: "clone",
      fallback: "default",
    });
  });

  it("blocks unreadable event types", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_roll",
      sessionId: "sess_1",
      type: "dice_roll",
      scope: "all",
      ts: new Date(),
      payload: { notation: "1d20" },
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_roll"), "sess_1");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "not_readable" });
  });

  it("does not retry Vocarium when a failed cache row already exists", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      id: "cache_failed",
      status: "failed",
      mimeType: null,
      byteLength: 0,
      voiceId: "2abffe14",
      error: "upstream boom",
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "tts_failed",
      message: "upstream boom",
    });
    expect(vocariumMock.synthesizeCloneSpeech).not.toHaveBeenCalled();
  });

  it("returns a storage error when ready-cache persistence fails without poisoning retries", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);
    vocariumMock.synthesizeCloneSpeech.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
    db.ttsAudioCacheCreate
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({
        id: "cache_retry",
        status: "ready",
        mimeType: "audio/wav",
        byteLength: 3,
        voiceId: "2abffe14",
      });

    const { handleSessionTts } = await import("./session-api");

    const failed = await handleSessionTts(post("ev_1"), "sess_1");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      error: "tts_storage_failed",
      message: "Failed to persist synthesized audio",
    });
    expect(db.ttsAudioCacheCreate).toHaveBeenCalledTimes(1);

    const retried = await handleSessionTts(post("ev_1"), "sess_1");
    const body = await retried.json();

    expect(retried.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      cacheId: "cache_retry",
      audioUrl: "/api/sessions/sess_1/tts/cache_retry",
    });
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledTimes(2);
    expect(db.ttsAudioCacheCreate).toHaveBeenCalledTimes(2);
  });

  it("streams cached audio only for authorized session members", async () => {
    accessMock.resolveAccess.mockResolvedValueOnce(null).mockResolvedValueOnce({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "player_1",
      displayName: "Player",
      memberId: "member_2",
      characterId: "char_1",
      inviteId: null,
    });
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      eventId: "ev_public",
      audio: Buffer.from([7, 8, 9]),
      mimeType: "audio/wav",
      byteLength: 3,
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_public",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Visible to players." },
    });

    const { handleSessionTtsAudio } = await import("./session-api");

    const forbidden = await handleSessionTtsAudio(get(), "sess_1", "cache_1");
    expect(forbidden.status).toBe(403);

    const ok = await handleSessionTtsAudio(get(), "sess_1", "cache_1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("audio/wav");
    expect(ok.headers.get("content-length")).toBe("3");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(Buffer.from([7, 8, 9]));
  });

  it("denies cached DM-scoped audio streams to players when the event is hidden", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "player_1",
      displayName: "Player",
      memberId: "member_2",
      characterId: "char_1",
      inviteId: null,
    });
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      eventId: "ev_dm",
      audio: Buffer.from([7, 8, 9]),
      mimeType: "audio/wav",
      byteLength: 3,
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_dm",
      sessionId: "sess_1",
      type: "narrate",
      scope: "dm",
      ts: new Date(),
      payload: { text: "DM only." },
    });

    const { handleSessionTtsAudio } = await import("./session-api");
    const response = await handleSessionTtsAudio(get(), "sess_1", "cache_1");

    expect(response.status).toBe(403);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("forbidden"),
    );
  });

  it("rejects invite requests when the path token does not match the claimed invite", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: null,
      displayName: "Guest",
      memberId: "member_guest",
      characterId: null,
      inviteId: "invite_cookie",
    });
    inviteTokenMock.parseToken.mockReturnValue({
      inviteId: "invite_path",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(
      post("ev_1"),
      "sess_1",
      "invite_path.999.sig",
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    expect(db.gameSessionFindUnique).not.toHaveBeenCalled();
  });

  it("rejects invite audio requests from authenticated non-guest access even with a valid path token", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    inviteTokenMock.parseToken.mockReturnValue({
      inviteId: "invite_path",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    });

    const { handleSessionTtsAudio } = await import("./session-api");
    const response = await handleSessionTtsAudio(
      get(),
      "sess_1",
      "cache_1",
      "invite_path.999.sig",
    );

    expect(response.status).toBe(403);
    expect(db.ttsAudioCacheFindFirst).not.toHaveBeenCalled();
  });

  it("recovers from a duplicate ready-cache race without re-synthesizing", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "cache_race",
        status: "ready",
        mimeType: "audio/wav",
        byteLength: 3,
        voiceId: "2abffe14",
        error: null,
      });
    vocariumMock.synthesizeCloneSpeech.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
    db.ttsAudioCacheCreate.mockRejectedValue({ code: "P2002" });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      cacheId: "cache_race",
      audioUrl: "/api/sessions/sess_1/tts/cache_race",
    });
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledTimes(1);
    expect(db.ttsAudioCacheFindFirst).toHaveBeenCalledTimes(2);
  });

  it("serves cached display audio only while the receiver capability is active", async () => {
    displayCapabilityMock.resolveActiveDisplayCapability.mockResolvedValue({
      version: 2,
      audience: "plum-display",
      sessionId: "sess_1",
      capabilityId: "capability-a",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: null },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([]);
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      id: "cache_1",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 12,
      voiceId: "default",
      error: null,
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(
      post("ev_1"),
      "sess_1",
      null,
      "display-token",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      audioUrl: "/api/display/sessions/sess_1/tts/audio/cache_1/display-token",
    });
    expect(
      displayCapabilityMock.consumeDisplayTtsBudget,
    ).not.toHaveBeenCalled();
    expect(vocariumMock.synthesizeCloneSpeech).not.toHaveBeenCalled();
  });

  it("rate-limits display-triggered cache misses before calling Vocarium", async () => {
    const claims = {
      version: 2,
      audience: "plum-display",
      sessionId: "sess_1",
      capabilityId: "capability-a",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    };
    displayCapabilityMock.resolveActiveDisplayCapability.mockResolvedValue(
      claims,
    );
    displayCapabilityMock.consumeDisplayTtsBudget.mockResolvedValue(false);
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: null },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(
      post("ev_1"),
      "sess_1",
      null,
      "display-token",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(displayCapabilityMock.consumeDisplayTtsBudget).toHaveBeenCalledWith(
      claims,
    );
    expect(vocariumMock.synthesizeCloneSpeech).not.toHaveBeenCalled();
    expect(db.ttsAudioCacheCreate).not.toHaveBeenCalled();
  });

  it("coalesces concurrent synthesis for the same visible display event", async () => {
    const claims = {
      version: 2,
      audience: "plum-display",
      sessionId: "sess_1",
      capabilityId: "capability-a",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    };
    displayCapabilityMock.resolveActiveDisplayCapability.mockResolvedValue(
      claims,
    );
    displayCapabilityMock.consumeDisplayTtsBudget.mockResolvedValue(true);
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: null },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);
    let releaseSpeech!: (value: { bytes: Buffer; mimeType: string }) => void;
    vocariumMock.synthesizeCloneSpeech.mockReturnValue(
      new Promise((resolve) => {
        releaseSpeech = resolve;
      }),
    );
    db.ttsAudioCacheCreate.mockResolvedValue({
      id: "cache_shared",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 3,
      voiceId: "default",
      error: null,
    });

    const { handleSessionTts } = await import("./session-api");
    const first = handleSessionTts(
      post("ev_1"),
      "sess_1",
      null,
      "display-token",
    );
    const second = handleSessionTts(
      post("ev_1"),
      "sess_1",
      null,
      "display-token",
    );
    await vi.waitFor(() =>
      expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledTimes(1),
    );
    releaseSpeech({ bytes: Buffer.from([1, 2, 3]), mimeType: "audio/wav" });

    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(displayCapabilityMock.consumeDisplayTtsBudget).toHaveBeenCalledTimes(
      1,
    );
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledTimes(1);
  });
});
