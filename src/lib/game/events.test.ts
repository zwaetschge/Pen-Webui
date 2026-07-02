import { describe, expect, it } from "vitest";
import { eventForClient } from "./events";
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
