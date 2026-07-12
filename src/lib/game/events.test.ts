import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  CURRENT_BOOTSTRAP_EVENT_TYPE,
  eventForClient,
} from "./events";
import type { GameEvent } from "./bus";

function event(overrides: Partial<GameEvent>): GameEvent {
  return {
    id: "ev_1",
    type: "narrate",
    payload: {},
    ts: 1,
    ...overrides,
  };
}

describe("eventForClient", () => {
  it("exports the complete bootstrap event sequence through the current version", () => {
    expect(CURRENT_BOOTSTRAP_EVENT_TYPE).toBe("session_bootstrap_v12");
    expect(BOOTSTRAP_EVENT_TYPES).toEqual([
      "session_bootstrap",
      "session_bootstrap_v2",
      "session_bootstrap_v3",
      "session_bootstrap_v4",
      "session_bootstrap_v5",
      "session_bootstrap_v6",
      "session_bootstrap_v7",
      "session_bootstrap_v8",
      "session_bootstrap_v9",
      "session_bootstrap_v10",
      "session_bootstrap_v11",
      "session_bootstrap_v12",
    ]);
  });

  it("keeps the current bootstrap event visible to live clients", () => {
    const bootstrap = event({
      type: "session_bootstrap_v12",
      payload: { sceneTitle: "Opening" },
    });

    expect(CLIENT_EVENT_TYPES).toContain("session_bootstrap_v12");
    expect(eventForClient(bootstrap, "host")).toBe(bootstrap);
  });

  it("does not replay internal transcript events to clients", () => {
    expect(
      eventForClient(
        event({ type: "tool_result", payload: { result: "secret" } }),
        "player",
      ),
    ).toBeNull();
    expect(
      eventForClient(
        event({ type: "assistant_message", payload: { toolCalls: [] } }),
        "host",
      ),
    ).toBeNull();
  });

  it("sanitizes hidden DM rolls for players", () => {
    const visible = eventForClient(
      event({
        type: "dice_roll",
        payload: {
          actor: "dm",
          notation: "1d20+8",
          total: 12,
          breakdown: "4 + 8",
          reason: "secret ambush",
          hidden: true,
          rolls: [{ die: 20, value: 4 }],
        },
      }),
      "player",
    );

    expect(visible?.payload).toMatchObject({
      notation: "verdeckter Wurf",
      total: 12,
      breakdown: "",
      hidden: true,
    });
    expect(visible?.payload.reason).toBeUndefined();
    expect(visible?.payload.rolls).toBeUndefined();
  });

  it("keeps full hidden roll details for the host", () => {
    const visible = eventForClient(
      event({
        type: "dice_roll",
        payload: {
          notation: "1d20+8",
          total: 12,
          breakdown: "4 + 8",
          hidden: true,
        },
      }),
      "host",
    );

    expect(visible?.payload.breakdown).toBe("4 + 8");
  });

  it("keeps world-state updates host-only", () => {
    const update = event({
      type: "world_state_updated",
      payload: { newThreads: ["hidden villain moves"] },
    });

    expect(eventForClient(update, "player")).toBeNull();
    expect(eventForClient(update, "host")).toBe(update);
  });

  it("keeps only the public DM fence when sanitizing player errors", () => {
    const dmError = event({
      type: "dm_error",
      payload: {
        message: "private upstream failure",
        stack: "secret stack",
        toolArguments: { password: "secret" },
        _dmTurnFence: 47,
      },
    });

    expect(eventForClient(dmError, "host")).toBe(dmError);
    expect(eventForClient(dmError, "player")?.payload).toEqual({
      message:
        "Der DM hatte ein internes Problem. Bitte sag der Spielleitung Bescheid.",
      _dmTurnFence: 47,
    });
  });

  it("replays lifecycle end events to players", () => {
    const gameOver = event({
      type: "game_over",
      payload: { outcome: "defeat", reason: "party_defeated" },
    });
    const sessionEnded = event({
      type: "session_ended",
      payload: { outcome: "defeat" },
    });

    expect(eventForClient(gameOver, "player")).toBe(gameOver);
    expect(eventForClient(sessionEnded, "player")).toBe(sessionEnded);
  });

  it("redacts private character fields from player bootstrap replay", () => {
    const visible = eventForClient(
      event({
        type: "session_bootstrap_v11",
        payload: {
          characters: [
            {
              id: "hero",
              name: "Robert",
              className: "Fighter",
              race: "Human",
              portraitUrl: "https://assets.example/hero.png",
              background: "Soldier",
              backstory: "Private secret",
            },
          ],
        },
      }),
      "player",
    );

    expect(visible?.payload.characters).toEqual([
      {
        id: "hero",
        name: "Robert",
        className: "Fighter",
        race: "Human",
        portraitUrl: "https://assets.example/hero.png",
      },
    ]);
  });
});
