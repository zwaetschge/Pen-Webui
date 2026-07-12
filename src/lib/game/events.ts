import type { GameEvent } from "./bus";

export type ClientRole = "host" | "player";

export const CURRENT_BOOTSTRAP_EVENT_TYPE = "session_bootstrap_v12";

export const BOOTSTRAP_EVENT_TYPES = [
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
  CURRENT_BOOTSTRAP_EVENT_TYPE,
] as const;

export type BootstrapEventType = (typeof BOOTSTRAP_EVENT_TYPES)[number];

const BOOTSTRAP_EVENT_TYPE_SET = new Set<string>(BOOTSTRAP_EVENT_TYPES);

export function isBootstrapEventType(
  value: string,
): value is BootstrapEventType {
  return BOOTSTRAP_EVENT_TYPE_SET.has(value);
}

export const LEGACY_BOOTSTRAP_EVENT_TYPES = BOOTSTRAP_EVENT_TYPES.filter(
  (type) => type !== CURRENT_BOOTSTRAP_EVENT_TYPE,
);

export const CLIENT_EVENT_TYPES = [
  ...BOOTSTRAP_EVENT_TYPES,
  "player_input",
  "intro_sequence",
  "narrate",
  "dice_roll",
  "skill_check_requested",
  "combat_started",
  "combat_action_used",
  "attack_resolved",
  "combat_turn_set",
  "combat_turn_ended",
  "combat_ended",
  "character_down",
  "death_save_updated",
  "character_dead",
  "party_defeated",
  "game_over",
  "session_ended",
  "scene_ended",
  "scene_set",
  "token_moved",
  "damage_applied",
  "status_applied",
  "asset_queued",
  "asset_ready",
  "dm_error",
  "dm_thinking",
  "world_state_updated",
] as const;

const CLIENT_EVENT_TYPE_SET = new Set<string>(CLIENT_EVENT_TYPES);

const PLAYER_HIDDEN_ROLL_PAYLOAD = {
  notation: "verdeckter Wurf",
  breakdown: "",
  reason: undefined,
  rolls: undefined,
  hidden: true,
};

export function eventForClient(
  ev: GameEvent,
  role: ClientRole,
): GameEvent | null {
  if (!CLIENT_EVENT_TYPE_SET.has(ev.type)) return null;
  if (ev.scope === "dm" && role !== "host") return null;
  if (role !== "host" && ev.type === "world_state_updated") return null;

  if (ev.type === "dice_roll" && role !== "host" && ev.payload.hidden) {
    return {
      ...ev,
      payload: {
        ...ev.payload,
        ...PLAYER_HIDDEN_ROLL_PAYLOAD,
      },
    };
  }

  if (ev.type === "dm_error" && role !== "host") {
    const fence = publicDmTurnFence(ev.payload._dmTurnFence);
    return {
      ...ev,
      payload: {
        message:
          "Der DM hatte ein internes Problem. Bitte sag der Spielleitung Bescheid.",
        ...(fence === null ? {} : { _dmTurnFence: fence }),
      },
    };
  }

  if (
    role !== "host" &&
    (ev.type.startsWith("session_bootstrap") || ev.type === "scene_set")
  ) {
    return {
      ...ev,
      payload: {
        ...ev.payload,
        characters: publicCharacters(ev.payload.characters),
      },
    };
  }

  return ev;
}

function publicDmTurnFence(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function publicCharacters(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    return [
      {
        id: typeof raw.id === "string" ? raw.id : "",
        name: typeof raw.name === "string" ? raw.name : "Character",
        className:
          typeof raw.className === "string" ? raw.className : undefined,
        race: typeof raw.race === "string" ? raw.race : undefined,
        portraitUrl:
          typeof raw.portraitUrl === "string" ? raw.portraitUrl : null,
      },
    ];
  });
}
