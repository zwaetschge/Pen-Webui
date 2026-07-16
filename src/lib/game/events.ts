import type { GameEvent } from "./bus";

export type ClientRole = "host" | "player";

export type ClientAudience = {
  role: ClientRole;
  characterId?: string | null;
  display?: boolean;
};

export const CURRENT_BOOTSTRAP_EVENT_TYPE = "session_bootstrap_v13";

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
  "session_bootstrap_v12",
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
  "saving_throw_resolved",
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
  "ability_used",
  "resource_spent",
  "resource_restored",
  "healing_applied",
  "status_updated",
  "concentration_changed",
  "reaction_opened",
  "reaction_resolved",
  "character_stabilized",
  "character_revived",
  "action_planned",
  "turn_group_set",
  "turn_member_completed",
  "surface_changed",
  "object_changed",
  "token_forced_moved",
  "stealth_changed",
  "token_revealed",
  "private_clue",
  "ai_intent",
  "encounter_objective_updated",
  "inventory_changed",
  "equipment_changed",
  "rest_proposed",
  "rest_vote_cast",
  "rest_completed",
  "dialogue_opened",
  "dialogue_vote_cast",
  "dialogue_resolved",
  "quest_updated",
  "decision_recorded",
  "reputation_changed",
] as const;

const CLIENT_EVENT_TYPE_SET = new Set<string>(CLIENT_EVENT_TYPES);

const PLAYER_HIDDEN_ROLL_PAYLOAD = {
  notation: "verdeckter Wurf",
  total: undefined,
  breakdown: "",
  reason: undefined,
  rolls: undefined,
  hidden: true,
};

export function eventForClient(
  ev: GameEvent,
  audienceInput: ClientRole | ClientAudience,
): GameEvent | null {
  const audience =
    typeof audienceInput === "string"
      ? { role: audienceInput, characterId: null, display: false }
      : audienceInput;
  const role = audience.role;
  if (!CLIENT_EVENT_TYPE_SET.has(ev.type)) return null;
  if (ev.scope === "dm" && role !== "host") return null;
  if (ev.scope === "display" && !audience.display && role !== "host") {
    return null;
  }
  if (ev.scope?.startsWith("character:")) {
    if (audience.display) return null;
    const targetCharacterId = ev.scope.slice("character:".length);
    if (role !== "host" && audience.characterId !== targetCharacterId) {
      return null;
    }
  }
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
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
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
