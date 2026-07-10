import { beforeEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_EVENT_TYPES } from "./events";
import { useGame, type ServerEvent } from "./store";

function event(overrides: Partial<ServerEvent>): ServerEvent {
  return {
    id: "ev_1",
    type: "narrate",
    payload: { text: "Die Tür öffnet sich." },
    ts: 1,
    ...overrides,
  };
}

describe("game store event ingestion", () => {
  beforeEach(() => {
    useGame.getState().reset();
  });

  it("deduplicates replayed events by id", () => {
    const ev = event({});

    useGame.getState().ingest(ev);
    useGame.getState().ingest(ev);

    expect(useGame.getState().chat).toHaveLength(1);
    expect(useGame.getState().chat[0]?.id).toBe(ev.id);
  });

  it("allows a fresh event after reset", () => {
    const ev = event({});

    useGame.getState().ingest(ev);
    useGame.getState().reset();
    useGame.getState().ingest(ev);

    expect(useGame.getState().chat).toHaveLength(1);
  });

  it("normalizes legacy string setup beats from an unversioned bootstrap", () => {
    const legacyText =
      "Im Diner Zur Grauen Wolldecke mustert Elinor Hale die Fremden.";

    useGame.getState().ingest(
      event({
        id: "legacy_unversioned_intro",
        type: "session_bootstrap",
        payload: {
          introSequence: {
            establishingShot: "Regen liegt ueber Cypress Hollow.",
            setupBeats: [legacyText],
            characterIntros: [],
            nextActions: [],
          },
        },
      }),
    );

    expect(useGame.getState().scene.introSequence?.setupBeats).toEqual([
      {
        title: "Begegnung mit Elinor Hale",
        text: legacyText,
      },
    ]);
  });

  it.each(BOOTSTRAP_EVENT_TYPES)(
    "consumes %s through the shared bootstrap contract",
    (type) => {
      useGame.getState().ingest(
        event({
          id: `bootstrap_${type}`,
          type,
          payload: { sceneTitle: `Scene for ${type}` },
        }),
      );

      expect(useGame.getState().scene.sceneTitle).toBe(`Scene for ${type}`);
    },
  );

  it("keeps individual dice values for the 3d dice overlay", () => {
    useGame.getState().ingest(
      event({
        id: "roll_1",
        type: "dice_roll",
        payload: {
          actor: "player",
          displayName: "Robert",
          notation: "2d6+3",
          total: 12,
          breakdown: "2d6[4,5] +3",
          rolls: [
            { die: 6, value: 4 },
            { die: 6, value: 5 },
          ],
        },
      }),
    );

    expect(useGame.getState().chat[0]).toMatchObject({
      kind: "roll",
      notation: "2d6+3",
      total: 12,
      dice: [
        { sides: 6, value: 4 },
        { sides: 6, value: 5 },
      ],
    });
  });

  it("keeps tactical map assets on the active scene", () => {
    useGame.getState().ingest(
      event({
        id: "boot",
        type: "session_bootstrap_v10",
        payload: {
          locationId: "loc_1",
          locationName: "Bone Gate",
          backgroundUrl: "https://assets.example/bg.png",
          tacticalMapUrl: "https://assets.example/map.png",
          gridConfig: { blockedTiles: ["2:3"] },
        },
      }),
    );

    expect(useGame.getState().scene.tacticalMapUrl).toBe(
      "https://assets.example/map.png",
    );
    expect(useGame.getState().scene.gridConfig?.blocked).toEqual([
      { x: 2, y: 3 },
    ]);

    useGame.getState().ingest(
      event({
        id: "asset_other",
        type: "asset_ready",
        payload: {
          assetId: "asset_other",
          kind: "location_tactical_map",
          refType: "location",
          refId: "loc_2",
          url: "https://assets.example/other-map.png",
        },
      }),
    );

    expect(useGame.getState().scene.tacticalMapUrl).toBe(
      "https://assets.example/map.png",
    );

    useGame.getState().ingest(
      event({
        id: "asset_current",
        type: "asset_ready",
        payload: {
          assetId: "asset_current",
          kind: "location_tactical_map",
          refType: "location",
          refId: "loc_1",
          url: "https://assets.example/current-map.png",
        },
      }),
    );

    expect(useGame.getState().scene.tacticalMapUrl).toBe(
      "https://assets.example/current-map.png",
    );
  });

  it("seeds exploration tokens from scene characters", () => {
    useGame.getState().ingest(
      event({
        id: "boot",
        type: "session_bootstrap_v10",
        payload: {
          characters: [
            {
              id: "hero",
              name: "Robert",
              portraitUrl: "https://assets.example/robert.png",
            },
          ],
        },
      }),
    );

    expect(useGame.getState().combat.active).toBe(false);
    expect(useGame.getState().tokens.hero).toMatchObject({
      id: "hero",
      name: "Robert",
      x: 2,
      y: 2,
      team: "player",
      assetUrl: "https://assets.example/robert.png",
    });
  });

  it("stores the structured adventure intro from bootstrap and live events", () => {
    useGame.getState().ingest(
      event({
        id: "boot_intro",
        type: "session_bootstrap_v11",
        payload: {
          introSequence: {
            title: "Opening",
            establishingShot: "Nebel liegt auf dem Dorfplatz.",
            setupBeats: ["Die Glocke schweigt.", "Ein Zeuge wartet."],
            characterIntros: [
              {
                characterId: "hero",
                name: "Robert",
                summary: "Human Fighter",
                prompt: "Robert, was sieht man zuerst?",
              },
            ],
            objective: "Findet die vermisste Kundschafterin.",
            stakes: "Die Spur erkaltet vor Sonnenuntergang.",
            firstPrompt: "Stellt euch kurz vor.",
            nextActions: ["Den Zeugen befragen."],
          },
        },
      }),
    );

    expect(useGame.getState().scene.introSequence).toMatchObject({
      establishingShot: "Nebel liegt auf dem Dorfplatz.",
      characterIntros: [
        {
          characterId: "hero",
          name: "Robert",
          prompt: "Robert, was sieht man zuerst?",
        },
      ],
      firstPrompt: "Stellt euch kurz vor.",
    });

    useGame.getState().ingest(
      event({
        id: "intro_live",
        type: "intro_sequence",
        payload: {
          establishingShot: "Die Kamera zieht enger.",
          setupBeats: ["Alle Blicke gehen zur alten Brücke."],
          characterIntros: [],
          objective: "Sichert die Brücke.",
          nextActions: ["Zur Brücke gehen."],
        },
      }),
    );

    expect(useGame.getState().scene.objective).toBe("Sichert die Brücke.");
    expect(useGame.getState().scene.nextActions).toEqual([
      "Zur Brücke gehen.",
    ]);
  });

  it("normalizes legacy and structured setup beats during replay", () => {
    const legacyText =
      "Im Diner Zur Grauen Wolldecke mustert Elinor Hale die Fremden.";
    useGame.getState().ingest(
      event({
        id: "legacy_intro",
        type: "session_bootstrap_v11",
        payload: {
          introSequence: {
            establishingShot: "Regen liegt ueber Cypress Hollow.",
            setupBeats: [legacyText],
            characterIntros: [],
            nextActions: [],
          },
        },
      }),
    );

    expect(useGame.getState().scene.introSequence?.setupBeats).toEqual([
      {
        title: "Begegnung mit Elinor Hale",
        text: legacyText,
      },
    ]);

    useGame.getState().ingest(
      event({
        id: "structured_intro",
        type: "session_bootstrap_v12",
        payload: {
          introSequence: {
            establishingShot: "Die Kamera zieht enger.",
            setupBeats: [
              {
                title: "Blicke im Diner",
                text: "Elinor Hale mustert die Fremden.",
              },
            ],
            characterIntros: [],
            nextActions: [],
          },
        },
      }),
    );

    expect(useGame.getState().scene.introSequence?.setupBeats).toEqual([
      {
        title: "Blicke im Diner",
        text: "Elinor Hale mustert die Fremden.",
      },
    ]);
  });

  it("updates the active initiative turn during combat", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [
            { name: "Guard", roll: 18 },
            { name: "Robert", roll: 12 },
          ],
          tokens: [],
        },
      }),
    );

    useGame.getState().ingest(
      event({
        id: "turn",
        type: "combat_turn_set",
        payload: {
          encounterId: "enc_1",
          turnIndex: 1,
          round: 2,
        },
      }),
    );

    expect(useGame.getState().combat.turnIndex).toBe(1);
    expect(useGame.getState().combat.round).toBe(2);
  });

  it("tracks spent movement for the current combat turn", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [{ name: "Robert", roll: 12, refId: "hero" }],
          tokens: [
            {
              id: "hero",
              name: "Robert",
              x: 1,
              y: 1,
              hp: 10,
              maxHp: 10,
              ac: 12,
              team: "player",
              movement: 6,
            },
          ],
        },
      }),
    );

    useGame.getState().ingest(
      event({
        id: "move_1",
        type: "token_moved",
        payload: {
          tokenId: "hero",
          x: 3,
          y: 1,
          movementCost: 2,
          round: 1,
          turnIndex: 0,
        },
      }),
    );
    useGame.getState().ingest(
      event({
        id: "move_2",
        type: "token_moved",
        payload: {
          tokenId: "hero",
          x: 5,
          y: 1,
          movementCost: 2,
          round: 1,
          turnIndex: 0,
        },
      }),
    );

    expect(useGame.getState().combat.movementSpent?.hero).toBe(4);

    useGame.getState().ingest(
      event({
        id: "turn",
        type: "combat_turn_set",
        payload: { encounterId: "enc_1", turnIndex: 0, round: 2 },
      }),
    );

    expect(useGame.getState().combat.movementSpent).toEqual({});
  });

  it("returns from combat to exploration with only player tokens", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [
            { name: "Robert", roll: 12, refId: "hero" },
            { name: "Goblin", roll: 8, refId: "goblin" },
          ],
          tokens: [
            {
              id: "hero",
              name: "Robert",
              x: 1,
              y: 1,
              hp: 10,
              maxHp: 10,
              ac: 12,
              team: "player",
              movement: 6,
            },
            {
              id: "goblin",
              name: "Goblin",
              x: 6,
              y: 1,
              hp: 7,
              maxHp: 7,
              ac: 13,
              team: "monster",
              movement: 6,
            },
          ],
        },
      }),
    );
    useGame.getState().ingest(
      event({
        id: "move",
        type: "token_moved",
        payload: {
          tokenId: "hero",
          x: 4,
          y: 1,
          movementCost: 3,
          round: 1,
          turnIndex: 0,
        },
      }),
    );
    useGame.getState().ingest(
      event({
        id: "ended",
        type: "combat_ended",
        payload: { summary: "Der Kampf endet." },
      }),
    );

    expect(useGame.getState().combat.active).toBe(false);
    expect(Object.keys(useGame.getState().tokens)).toEqual(["hero"]);
    expect(useGame.getState().tokens.hero).toMatchObject({ x: 4, y: 1 });
  });

  it("tracks combat action resources and dash movement bonus", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [{ name: "Robert", roll: 12, refId: "hero" }],
          tokens: [
            {
              id: "hero",
              name: "Robert",
              x: 1,
              y: 1,
              hp: 10,
              maxHp: 10,
              ac: 12,
              team: "player",
              movement: 6,
            },
          ],
        },
      }),
    );

    useGame.getState().ingest(
      event({
        id: "dash",
        type: "combat_action_used",
        payload: {
          tokenId: "hero",
          actionType: "dash",
          resource: "action",
          movementBonus: 6,
          round: 1,
          turnIndex: 0,
        },
      }),
    );

    expect(useGame.getState().combat.resources?.hero).toMatchObject({
      actionUsed: true,
      dash: true,
      movementBonus: 6,
    });

    useGame.getState().ingest(
      event({
        id: "turn",
        type: "combat_turn_set",
        payload: { encounterId: "enc_1", turnIndex: 0, round: 2 },
      }),
    );

    expect(useGame.getState().combat.resources).toEqual({});
  });

  it("records attack resolution and applies damage", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [
            { name: "Robert", roll: 12, refId: "hero" },
            { name: "Goblin", roll: 8, refId: "goblin" },
          ],
          tokens: [
            {
              id: "hero",
              name: "Robert",
              x: 1,
              y: 1,
              hp: 10,
              maxHp: 10,
              ac: 12,
              team: "player",
              movement: 6,
            },
            {
              id: "goblin",
              name: "Goblin",
              x: 2,
              y: 1,
              hp: 7,
              maxHp: 7,
              ac: 13,
              team: "monster",
              movement: 6,
            },
          ],
        },
      }),
    );

    useGame.getState().ingest(
      event({
        id: "attack",
        type: "attack_resolved",
        payload: {
          actorTokenId: "hero",
          actorName: "Robert",
          targetTokenId: "goblin",
          targetName: "Goblin",
          attackTotal: 18,
          targetAc: 13,
          hit: true,
          critical: false,
          damage: 5,
          damageType: "slashing",
        },
      }),
    );
    useGame.getState().ingest(
      event({
        id: "damage",
        type: "damage_applied",
        payload: { targetId: "goblin", amount: 5, type: "slashing" },
      }),
    );

    expect(useGame.getState().combat.lastAction).toMatchObject({
      actorName: "Robert",
      targetName: "Goblin",
      hit: true,
      damage: 5,
    });
    expect(useGame.getState().tokens.goblin.hp).toBe(2);
  });

  it("keeps a visible game-over state for combat defeat", () => {
    useGame.getState().ingest(
      event({
        id: "combat",
        type: "combat_started",
        payload: {
          encounterId: "enc_1",
          name: "Gate fight",
          initiative: [
            { name: "Robert", roll: 12, refId: "hero" },
            { name: "Goblin", roll: 8, refId: "goblin" },
          ],
          tokens: [
            {
              id: "hero",
              name: "Robert",
              x: 1,
              y: 1,
              hp: 0,
              maxHp: 10,
              ac: 12,
              team: "player",
              movement: 6,
            },
            {
              id: "goblin",
              name: "Goblin",
              x: 2,
              y: 1,
              hp: 7,
              maxHp: 7,
              ac: 13,
              team: "monster",
              movement: 6,
            },
          ],
        },
      }),
    );

    useGame.getState().ingest(
      event({
        id: "ended",
        type: "combat_ended",
        payload: {
          outcome: "defeat",
          summary: "Kampf beendet: Niederlage.",
        },
      }),
    );

    expect(useGame.getState().combat).toMatchObject({
      active: false,
      outcome: "defeat",
      endedSummary: "Kampf beendet: Niederlage.",
    });
    expect(useGame.getState().sessionEnded).toBe(true);
    expect(useGame.getState().gameOver).toMatchObject({
      outcome: "defeat",
      reason: "party_defeated",
      title: "Game Over",
      summary: "Kampf beendet: Niederlage.",
    });
    expect(Object.keys(useGame.getState().tokens)).toEqual(["hero"]);
  });

  it("ingests explicit game-over events with defeated names", () => {
    useGame.getState().ingest(
      event({
        id: "game_over",
        type: "game_over",
        payload: {
          outcome: "defeat",
          reason: "party_defeated",
          title: "Game Over",
          summary: "Die Gruppe wurde besiegt.",
          defeatedTokenIds: ["hero"],
          defeatedNames: ["Robert"],
        },
      }),
    );

    expect(useGame.getState().sessionEnded).toBe(true);
    expect(useGame.getState().dmThinking).toBe(false);
    expect(useGame.getState().gameOver).toMatchObject({
      outcome: "defeat",
      defeatedTokenIds: ["hero"],
      defeatedNames: ["Robert"],
    });
  });
});
