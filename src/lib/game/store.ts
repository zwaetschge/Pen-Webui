"use client";

/**
 * Client-side game state.
 *
 *   - Live event log (latest 500)
 *   - Derived view: chat-feed lines, dice rolls, narrate prose, combat state
 *   - Active scene / location backdrop
 *   - Combat: initiative, tokens, fog
 *
 * Events flow in from the SSE stream (see useGameStream) and the reducer
 * folds them into a shape that React components consume.
 */

import { create } from "zustand";
import {
  applyCombatResourceEvent,
  combatResourceEvent,
  type CombatResourceState,
} from "./combat-resources";
import { isBootstrapEventType } from "./events";
import { normalizeMovementGrid, type MovementGrid } from "./movement";
import { normalizeOpeningBeats, type OpeningBeat } from "./opening-beat";

export type ChatLine =
  | {
      kind: "narrate";
      id: string;
      ts: number;
      text: string;
      speakerNpcId?: string | null;
      mood?: string;
    }
  | {
      kind: "player";
      id: string;
      ts: number;
      displayName: string;
      text: string;
    }
  | {
      kind: "system";
      id: string;
      ts: number;
      text: string;
      tone?: "info" | "warn" | "danger";
    }
  | {
      kind: "roll";
      id: string;
      ts: number;
      actor: string;
      displayName?: string;
      notation: string;
      total: number;
      breakdown: string;
      reason?: string;
      dice?: VisualDie[];
    }
  | {
      kind: "skill_check_request";
      id: string;
      ts: number;
      characterId: string;
      skill: string;
      dc: number;
      reason?: string;
    };

export type VisualDie = {
  sides: number;
  value: number;
  dropped?: boolean;
};

export type Token = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  team: "player" | "monster" | "npc";
  movement?: number;
  attackBonus?: number | null;
  damageDice?: string | null;
  damageType?: string | null;
  attackRange?: number | null;
  assetUrl?: string | null;
  statuses?: Array<{ condition: string; durationRounds?: number }>;
};

export type CombatLogEntry = {
  id: string;
  ts: number;
  actorTokenId: string;
  actorName: string;
  targetTokenId: string;
  targetName: string;
  attackTotal: number;
  targetAc: number;
  hit: boolean;
  critical: boolean;
  damage: number;
  damageType?: string | null;
  disadvantage?: boolean;
};

export type CombatState = {
  active: boolean;
  encounterId?: string;
  name?: string;
  round?: number;
  turnIndex?: number;
  outcome?: "victory" | "defeat" | "fled" | "unknown";
  endedSummary?: string | null;
  endedAt?: number;
  initiative?: Array<{ name: string; roll: number; refId?: string | null }>;
  movementSpent?: Record<string, number>;
  resources?: Record<string, CombatResourceState>;
  lastAction?: CombatLogEntry | null;
};

export type GameOverState = {
  outcome: "defeat" | "victory" | "unknown";
  reason?: string | null;
  title: string;
  summary?: string | null;
  defeatedTokenIds: string[];
  defeatedNames: string[];
  ts: number;
};

export type SceneState = {
  locationId?: string | null;
  sceneTitle?: string;
  locationName?: string;
  locationDescription?: string | null;
  backgroundUrl?: string | null;
  tacticalMapUrl?: string | null;
  gridConfig?: MovementGrid;
  summary?: string | null;
  hook?: string | null;
  objective?: string | null;
  whyHere?: string | null;
  stakes?: string | null;
  nextActions?: string[];
  presentNpcs?: Array<{
    id: string;
    name: string;
    role?: string | null;
    portraitUrl?: string | null;
  }>;
  characters?: Array<{
    id: string;
    name: string;
    className?: string | null;
    race?: string | null;
    portraitUrl?: string | null;
  }>;
  introSequence?: IntroSequenceState | null;
  activeNpc?: {
    id: string;
    name?: string;
    portraitUrl?: string | null;
    mood?: string;
  } | null;
};

export type IntroSequenceState = {
  title?: string;
  establishingShot?: string | null;
  setupBeats: OpeningBeat[];
  whyHere?: string | null;
  characterHookStyle?: string | null;
  characterIntros: Array<{
    characterId: string;
    name: string;
    summary?: string | null;
    prompt?: string | null;
    text?: string | null;
    portraitUrl?: string | null;
  }>;
  objective?: string | null;
  stakes?: string | null;
  firstPrompt?: string | null;
  nextActions: string[];
};

export type AssetReady = {
  assetId: string;
  url: string;
  kind: string;
  refType?: string;
  refId?: string;
};

type GameState = {
  sessionId: string | null;
  role: "host" | "player" | null;
  displayName: string | null;
  chat: ChatLine[];
  scene: SceneState;
  combat: CombatState;
  gameOver: GameOverState | null;
  sessionEnded: boolean;
  tokens: Record<string, Token>;
  awaitingSkillCheck: {
    characterId: string;
    skill: string;
    dc: number;
    reason?: string;
  } | null;
  assetsReady: AssetReady[];
  dmThinking: boolean;
  highestDmTurnFence: number;
  connected: boolean;
  error: string | null;
  seenEventIds: Record<string, true>;
  seenEventOrder: string[];
};

type GameActions = {
  reset: () => void;
  setConnection: (state: { connected: boolean; error?: string | null }) => void;
  setRole: (s: {
    role: "host" | "player";
    displayName: string;
    sessionId: string;
  }) => void;
  ingest: (ev: ServerEvent) => void;
  appendLine: (line: ChatLine) => void;
};

export type ServerEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
};

const initial: GameState = {
  sessionId: null,
  role: null,
  displayName: null,
  chat: [],
  scene: {},
  combat: { active: false },
  gameOver: null,
  sessionEnded: false,
  tokens: {},
  awaitingSkillCheck: null,
  assetsReady: [],
  dmThinking: false,
  highestDmTurnFence: 0,
  connected: false,
  error: null,
  seenEventIds: {},
  seenEventOrder: [],
};

export const useGame = create<GameState & GameActions>((set, get) => ({
  ...initial,
  reset: () =>
    set({
      ...initial,
      scene: {},
      combat: { active: false },
      gameOver: null,
      sessionEnded: false,
      tokens: {},
      assetsReady: [],
      highestDmTurnFence: 0,
      seenEventIds: {},
      seenEventOrder: [],
    }),
  setConnection: ({ connected, error }) =>
    set({ connected, error: error ?? null }),
  setRole: ({ role, displayName, sessionId }) =>
    set({ role, displayName, sessionId }),
  appendLine: (line) => set((s) => trimChat(s.chat.concat(line))),
  ingest: (ev) => {
    const dmTurnFence = numericDmTurnFence(ev.payload._dmTurnFence);
    if (dmTurnFence !== null) {
      const highestDmTurnFence = get().highestDmTurnFence;
      if (dmTurnFence < highestDmTurnFence) return;
      if (dmTurnFence > highestDmTurnFence) set({ highestDmTurnFence: dmTurnFence });
    }

    if (ev.id) {
      if (get().seenEventIds[ev.id]) return;
      set((s) => rememberEvent(s, ev.id));
    }

    if (isBootstrapEventType(ev.type)) {
      set((s) => {
        const characters = characterList(ev.payload.characters);
        return {
          scene: {
            ...s.scene,
            sceneTitle: stringField(ev.payload.sceneTitle),
            locationId: nullableStringField(ev.payload.locationId),
            locationName: stringField(ev.payload.locationName),
            locationDescription: nullableStringField(
              ev.payload.locationDescription,
            ),
            backgroundUrl: nullableStringField(ev.payload.backgroundUrl),
            tacticalMapUrl: nullableStringField(ev.payload.tacticalMapUrl),
            gridConfig: normalizeMovementGrid(ev.payload.gridConfig),
            summary: nullableStringField(ev.payload.summary),
            hook: nullableStringField(ev.payload.hook),
            objective: nullableStringField(ev.payload.objective),
            whyHere: nullableStringField(ev.payload.whyHere),
            stakes: nullableStringField(ev.payload.stakes),
            nextActions: stringList(ev.payload.nextActions),
            presentNpcs: npcList(ev.payload.presentNpcs),
            characters,
            introSequence: introSequenceField(ev.payload.introSequence),
          },
          tokens: s.combat.active
            ? s.tokens
            : explorationTokensFromCharacters({
                characters,
                currentTokens: s.tokens,
                resetPositions: false,
              }),
        };
      });
      return;
    }

    switch (ev.type) {
      case "player_input": {
        const text = String(ev.payload.text ?? "");
        const displayName = String(ev.payload.displayName ?? "Spieler");
        if (!text) break;
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "player",
              id: ev.id,
              ts: ev.ts,
              displayName,
              text,
            }),
          ),
        );
        break;
      }
      case "intro_sequence": {
        const introSequence = introSequenceField(ev.payload);
        if (!introSequence) break;
        set((s) => ({
          scene: {
            ...s.scene,
            introSequence,
            objective: introSequence.objective ?? s.scene.objective,
            stakes: introSequence.stakes ?? s.scene.stakes,
            nextActions:
              introSequence.nextActions.length > 0
                ? introSequence.nextActions
                : s.scene.nextActions,
          },
        }));
        break;
      }
      case "narrate": {
        const text = String(ev.payload.text ?? "");
        if (!text) break;
        const speakerNpcId = (ev.payload.speakerNpcId as string | null) ?? null;
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "narrate",
              id: ev.id,
              ts: ev.ts,
              text,
              speakerNpcId,
              mood: ev.payload.mood as string | undefined,
            }),
          ),
        );
        set((s) => ({
          scene: {
            ...s.scene,
            activeNpc: speakerNpcId
              ? {
                  id: speakerNpcId,
                  name: (ev.payload.speakerName as string | null) ?? undefined,
                  portraitUrl:
                    (ev.payload.speakerPortraitUrl as string | null) ?? null,
                  mood: ev.payload.mood as string | undefined,
                }
              : (s.scene.activeNpc ?? null),
          },
        }));
        break;
      }
      case "dice_roll": {
        const reasonField = ev.payload.reason;
        const reason =
          typeof reasonField === "string" ? reasonField : undefined;
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "roll",
              id: ev.id,
              ts: ev.ts,
              actor: String(ev.payload.actor ?? "dm"),
              displayName: ev.payload.displayName as string | undefined,
              notation: String(ev.payload.notation ?? ""),
              total: Number(ev.payload.total ?? 0),
              breakdown: String(ev.payload.breakdown ?? ""),
              reason,
              dice: visualDiceFromPayload(ev.payload),
            }),
          ),
        );
        const characterId =
          typeof ev.payload.characterId === "string"
            ? ev.payload.characterId
            : null;
        const awaiting = get().awaitingSkillCheck;
        if (
          awaiting &&
          (characterId === awaiting.characterId ||
            (reason ?? "").toLowerCase().includes(awaiting.skill.toLowerCase()))
        ) {
          set({ awaitingSkillCheck: null });
        }
        break;
      }
      case "skill_check_requested": {
        set({
          awaitingSkillCheck: {
            characterId: String(ev.payload.characterId ?? ""),
            skill: String(ev.payload.skill ?? "Athletik"),
            dc: Number(ev.payload.dc ?? 10),
            reason: ev.payload.reason as string | undefined,
          },
        });
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "skill_check_request",
              id: ev.id,
              ts: ev.ts,
              characterId: String(ev.payload.characterId ?? ""),
              skill: String(ev.payload.skill ?? "Athletik"),
              dc: Number(ev.payload.dc ?? 10),
              reason: ev.payload.reason as string | undefined,
            }),
          ),
        );
        break;
      }
      case "combat_started": {
        const tokens = (ev.payload.tokens as Token[] | undefined) ?? [];
        set((s) => ({
          combat: {
            active: true,
            encounterId: String(ev.payload.encounterId ?? ""),
            name: String(ev.payload.name ?? "Kampf"),
            round: 1,
            turnIndex: 0,
            outcome: undefined,
            endedSummary: null,
            endedAt: undefined,
            movementSpent: {},
            resources: {},
            lastAction: null,
            initiative:
              (ev.payload.initiative as Array<{
                name: string;
                roll: number;
                refId?: string | null;
              }>) ?? [],
          },
          tokens: {
            ...s.tokens,
            ...Object.fromEntries(tokens.map((t) => [t.id, t])),
          },
        }));
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `Kampf beginnt: ${ev.payload.name}`,
              tone: "warn",
            }),
          ),
        );
        break;
      }
      case "combat_turn_set": {
        const nextIndex =
          typeof ev.payload.turnIndex === "number"
            ? Math.max(0, Math.floor(ev.payload.turnIndex))
            : undefined;
        const nextRound =
          typeof ev.payload.round === "number"
            ? Math.max(1, Math.floor(ev.payload.round))
            : undefined;
        set((s) => {
          const currentTurnIndex = s.combat.turnIndex ?? 0;
          const currentRound = s.combat.round ?? 1;
          const resolvedTurnIndex = nextIndex ?? currentTurnIndex;
          const resolvedRound = nextRound ?? currentRound;
          const turnChanged =
            resolvedTurnIndex !== currentTurnIndex ||
            resolvedRound !== currentRound;
          return {
            combat: {
              ...s.combat,
              active: true,
              encounterId:
                stringField(ev.payload.encounterId) ?? s.combat.encounterId,
              turnIndex: resolvedTurnIndex,
              round: resolvedRound,
              movementSpent: turnChanged ? {} : (s.combat.movementSpent ?? {}),
              resources: turnChanged ? {} : (s.combat.resources ?? {}),
            },
          };
        });
        break;
      }
      case "combat_action_used": {
        const action = combatResourceEvent(ev.payload);
        if (!action) break;
        set((s) => ({
          combat: {
            ...s.combat,
            resources: {
              ...(s.combat.resources ?? {}),
              [action.tokenId]: applyCombatResourceEvent(
                s.combat.resources?.[action.tokenId],
                action,
              ),
            },
          },
        }));
        break;
      }
      case "attack_resolved": {
        const entry: CombatLogEntry = {
          id: ev.id,
          ts: ev.ts,
          actorTokenId: String(ev.payload.actorTokenId ?? ""),
          actorName: String(ev.payload.actorName ?? "Angreifer"),
          targetTokenId: String(ev.payload.targetTokenId ?? ""),
          targetName: String(ev.payload.targetName ?? "Ziel"),
          attackTotal: Number(ev.payload.attackTotal ?? 0),
          targetAc: Number(ev.payload.targetAc ?? 10),
          hit: Boolean(ev.payload.hit),
          critical: Boolean(ev.payload.critical),
          damage: Number(ev.payload.damage ?? 0),
          damageType:
            typeof ev.payload.damageType === "string"
              ? ev.payload.damageType
              : null,
          disadvantage: Boolean(ev.payload.disadvantage),
        };
        set((s) => ({ combat: { ...s.combat, lastAction: entry } }));
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: entry.hit
                ? `${entry.actorName} trifft ${entry.targetName} (${entry.attackTotal} gegen RK ${entry.targetAc}) für ${entry.damage} Schaden.`
                : `${entry.actorName} verfehlt ${entry.targetName} (${entry.attackTotal} gegen RK ${entry.targetAc}).`,
              tone: entry.hit ? "danger" : "warn",
            }),
          ),
        );
        break;
      }
      case "combat_turn_ended": {
        break;
      }
      case "combat_ended": {
        const outcome = combatOutcome(ev.payload.outcome);
        const summary = ev.payload.summary as string | undefined;
        set((s) => ({
          combat: {
            ...s.combat,
            active: false,
            outcome,
            endedSummary: summary ?? null,
            endedAt: ev.ts,
            movementSpent: {},
            resources: {},
          },
          awaitingSkillCheck: null,
          tokens: playerTokensFromCombat(s.tokens),
          gameOver:
            outcome === "defeat" && !s.gameOver
              ? gameOverFromPayload(ev, {
                  outcome: "defeat",
                  reason: "party_defeated",
                  title: "Game Over",
                  fallbackSummary:
                    summary ?? "Die Gruppe wurde im Kampf besiegt.",
                })
              : s.gameOver,
          sessionEnded: outcome === "defeat" ? true : s.sessionEnded,
          dmThinking: outcome === "defeat" ? false : s.dmThinking,
        }));
        if (summary) {
          set((s) =>
            trimChat(
              s.chat.concat({
                kind: "system",
                id: ev.id,
                ts: ev.ts,
                text: summary,
                tone: "info",
              }),
            ),
          );
        }
        break;
      }
      case "character_down": {
        const tokenId = String(ev.payload.tokenId ?? "");
        const tokenName = String(ev.payload.tokenName ?? tokenId);
        if (!tokenId) break;
        set((s) => ({
          tokens: tokenId
            ? updateTokenStatus(s.tokens, tokenId, {
                condition: "unconscious",
              })
            : s.tokens,
        }));
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `${tokenName} ist kampfunfähig.`,
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "death_save_updated": {
        const tokenName = String(
          ev.payload.tokenName ?? ev.payload.characterId ?? "Figur",
        );
        const successes = Number(ev.payload.successes ?? 0);
        const failures = Number(ev.payload.failures ?? 0);
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `${tokenName}: Todesrettungswurf ${successes}/3 Erfolg, ${failures}/3 Fehlschlag.`,
              tone: failures >= 2 ? "danger" : "warn",
            }),
          ),
        );
        break;
      }
      case "character_dead": {
        const tokenId = String(
          ev.payload.tokenId ?? ev.payload.characterId ?? "",
        );
        const tokenName = String(ev.payload.tokenName ?? tokenId);
        if (!tokenId) break;
        set((s) => ({
          tokens: updateTokenStatus(s.tokens, tokenId, {
            condition: "dead",
          }),
        }));
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `${tokenName} ist gestorben.`,
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "party_defeated": {
        const summary =
          stringField(ev.payload.summary) ??
          "Alle Spielerfiguren sind besiegt.";
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: summary,
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "game_over": {
        set((s) => ({
          combat: {
            ...s.combat,
            active: false,
            outcome: combatOutcome(ev.payload.outcome),
            endedSummary:
              stringField(ev.payload.summary) ?? s.combat.endedSummary ?? null,
            endedAt: ev.ts,
            movementSpent: {},
            resources: {},
          },
          awaitingSkillCheck: null,
          dmThinking: false,
          sessionEnded: true,
          tokens: playerTokensFromCombat(s.tokens),
          gameOver: gameOverFromPayload(ev, {
            outcome: "defeat",
            reason: "party_defeated",
            title: "Game Over",
            fallbackSummary: "Die Gruppe wurde besiegt.",
          }),
        }));
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text:
                stringField(ev.payload.summary) ??
                "Game Over: Die Gruppe wurde besiegt.",
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "session_ended": {
        set((s) => ({
          sessionEnded: true,
          dmThinking: false,
          awaitingSkillCheck: null,
          gameOver:
            s.gameOver ??
            gameOverFromPayload(ev, {
              outcome: gameOutcome(ev.payload.outcome),
              reason: stringField(ev.payload.reason),
              title: "Session beendet",
              fallbackSummary: stringField(ev.payload.summary),
            }),
        }));
        break;
      }
      case "scene_ended": {
        set({
          combat: { active: false },
          awaitingSkillCheck: null,
          tokens: {},
        });
        const summary = ev.payload.summary as string | undefined;
        if (summary) {
          set((s) =>
            trimChat(
              s.chat.concat({
                kind: "system",
                id: ev.id,
                ts: ev.ts,
                text: summary,
                tone: "info",
              }),
            ),
          );
        }
        break;
      }
      case "token_moved": {
        const tokenId = String(ev.payload.tokenId ?? "");
        const x = Number(ev.payload.x ?? 0);
        const y = Number(ev.payload.y ?? 0);
        const movementCost = nonNegativeIntegerField(ev.payload.movementCost);
        set((s) => ({
          combat:
            movementCost !== undefined &&
            movementCost > 0 &&
            movementEventMatchesActiveTurn(s.combat, ev.payload)
              ? {
                  ...s.combat,
                  movementSpent: {
                    ...(s.combat.movementSpent ?? {}),
                    [tokenId]:
                      (s.combat.movementSpent?.[tokenId] ?? 0) + movementCost,
                  },
                }
              : s.combat,
          tokens: {
            ...s.tokens,
            [tokenId]: {
              ...(s.tokens[tokenId] ?? {
                id: tokenId,
                name: tokenId,
                hp: 0,
                maxHp: 0,
                ac: 10,
                team: "monster",
              }),
              x,
              y,
            },
          },
        }));
        break;
      }
      case "damage_applied": {
        const targetId = String(ev.payload.targetId ?? "");
        const amount = Number(ev.payload.amount ?? 0);
        let targetName = targetId;
        set((s) => {
          const t = s.tokens[targetId];
          if (!t) return s;
          targetName = t.name;
          return {
            tokens: {
              ...s.tokens,
              [targetId]: { ...t, hp: Math.max(0, t.hp - amount) },
            },
          };
        });
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `${amount} ${ev.payload.type ?? ""} Schaden an ${targetName}`.trim(),
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "status_applied": {
        const targetId = String(ev.payload.targetId ?? "");
        const condition = String(ev.payload.condition ?? "").trim();
        const duration =
          typeof ev.payload.durationRounds === "number"
            ? ev.payload.durationRounds
            : undefined;
        if (!targetId || !condition) break;
        let targetName = targetId;
        set((s) => {
          const token = s.tokens[targetId];
          if (!token) return s;
          targetName = token.name;
          const existing = token.statuses ?? [];
          const next =
            duration === 0
              ? existing.filter(
                  (x) => x.condition.toLowerCase() !== condition.toLowerCase(),
                )
              : [
                  ...existing.filter(
                    (x) =>
                      x.condition.toLowerCase() !== condition.toLowerCase(),
                  ),
                  { condition, durationRounds: duration },
                ];
          return {
            tokens: {
              ...s.tokens,
              [targetId]: { ...token, statuses: next },
            },
          };
        });
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text:
                duration === 0
                  ? `${condition} von ${targetName} entfernt`
                  : `${targetName}: ${condition}${
                      duration ? ` für ${duration} Runden` : ""
                    }`,
              tone: "warn",
            }),
          ),
        );
        break;
      }
      case "asset_ready":
      case "asset_queued": {
        if (ev.type === "asset_queued") {
          set((s) =>
            trimChat(
              s.chat.concat({
                kind: "system",
                id: ev.id,
                ts: ev.ts,
                text: `Asset vorgemerkt: ${String(ev.payload.kind ?? "Bild").replace(/_/g, " ")}`,
                tone: "info",
              }),
            ),
          );
          break;
        }
        if (!ev.payload.url) break;
        const url = String(ev.payload.url);
        const refType = ev.payload.refType as string | undefined;
        const refId = ev.payload.refId as string | undefined;
        const kind = String(ev.payload.kind ?? "");
        set((s) => ({
          assetsReady: [
            ...s.assetsReady.slice(-49),
            {
              assetId: String(ev.payload.assetId ?? ""),
              url,
              kind,
              refType,
              refId,
            },
          ],
        }));
        // Slot the asset into the live scene if it concerns the current view.
        if (refType === "location" && kind === "location_background") {
          set((s) =>
            sceneAssetMatches(s.scene, refId)
              ? { scene: { ...s.scene, backgroundUrl: url } }
              : s,
          );
        }
        if (refType === "location" && kind === "location_tactical_map") {
          set((s) =>
            sceneAssetMatches(s.scene, refId)
              ? { scene: { ...s.scene, tacticalMapUrl: url } }
              : s,
          );
        }
        if (refType === "npc" && kind === "npc_portrait") {
          set((s) => {
            const cur = s.scene.activeNpc;
            if (!cur || cur.id !== refId) return s;
            return {
              scene: {
                ...s.scene,
                activeNpc: { ...cur, portraitUrl: url },
              },
            };
          });
        }
        if (kind.endsWith("_token") && refId) {
          set((s) => {
            const token = s.tokens[refId];
            if (!token) return s;
            return {
              tokens: {
                ...s.tokens,
                [refId]: { ...token, assetUrl: url },
              },
            };
          });
        }
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `Asset bereit: ${kind.replace(/_/g, " ")}`,
              tone: "info",
            }),
          ),
        );
        break;
      }
      case "scene_set": {
        set((s) => {
          const nextLocationId =
            nullableStringField(ev.payload.locationId) ?? s.scene.locationId;
          const locationChanged =
            Boolean(nextLocationId) && nextLocationId !== s.scene.locationId;
          const characters =
            characterList(ev.payload.characters) ?? s.scene.characters;
          return {
            scene: {
              ...s.scene,
              sceneTitle:
                stringField(ev.payload.sceneTitle) ?? s.scene.sceneTitle,
              locationId: nextLocationId,
              locationName:
                stringField(ev.payload.locationName) ?? s.scene.locationName,
              locationDescription:
                nullableStringField(ev.payload.locationDescription) ??
                s.scene.locationDescription,
              backgroundUrl:
                nullableStringField(ev.payload.backgroundUrl) ??
                s.scene.backgroundUrl ??
                null,
              tacticalMapUrl:
                nullableStringField(ev.payload.tacticalMapUrl) ??
                s.scene.tacticalMapUrl ??
                null,
              gridConfig:
                normalizeMovementGrid(ev.payload.gridConfig) ??
                s.scene.gridConfig,
              summary:
                nullableStringField(ev.payload.summary) ?? s.scene.summary,
              hook: nullableStringField(ev.payload.hook) ?? s.scene.hook,
              objective:
                nullableStringField(ev.payload.objective) ?? s.scene.objective,
              whyHere:
                nullableStringField(ev.payload.whyHere) ?? s.scene.whyHere,
              stakes: nullableStringField(ev.payload.stakes) ?? s.scene.stakes,
              nextActions:
                stringList(ev.payload.nextActions) ?? s.scene.nextActions,
              presentNpcs:
                npcList(ev.payload.presentNpcs) ?? s.scene.presentNpcs,
              characters,
              activeNpc: null,
            },
            tokens: s.combat.active
              ? s.tokens
              : explorationTokensFromCharacters({
                  characters,
                  currentTokens: s.tokens,
                  resetPositions: locationChanged,
                }),
          };
        });
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `Szene: ${String(ev.payload.locationName ?? "unbekannt")}`,
              tone: "info",
            }),
          ),
        );
        break;
      }
      case "world_state_updated": {
        const facts = Array.isArray(ev.payload.worldFacts)
          ? ev.payload.worldFacts.length
          : 0;
        const threads = Array.isArray(ev.payload.newThreads)
          ? ev.payload.newThreads.length
          : 0;
        const closed = Array.isArray(ev.payload.closedThreads)
          ? ev.payload.closedThreads.length
          : 0;
        const parts = [
          facts ? `${facts} Fakten` : "",
          threads ? `${threads} Erzählfäden geöffnet` : "",
          closed ? `${closed} Erzählfäden geschlossen` : "",
        ].filter(Boolean);
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: parts.length
                ? `Weltzustand aktualisiert: ${parts.join(", ")}`
                : "Weltzustand aktualisiert",
              tone: "info",
            }),
          ),
        );
        break;
      }
      case "dm_error": {
        const msg = String(ev.payload.message ?? "DM-Fehler");
        set((s) =>
          trimChat(
            s.chat.concat({
              kind: "system",
              id: ev.id,
              ts: ev.ts,
              text: `DM-Fehler: ${msg}`,
              tone: "danger",
            }),
          ),
        );
        break;
      }
      case "dm_thinking": {
        set({ dmThinking: Boolean(ev.payload.active) });
        break;
      }
      default:
        // unknown event types are ignored
        break;
    }
  },
}));

function numericDmTurnFence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function rememberEvent(state: GameState, id: string) {
  const nextOrder = state.seenEventOrder.concat(id).slice(-1000);
  const keep = new Set(nextOrder);
  const seenEventIds: Record<string, true> = {};
  for (const eventId of keep) seenEventIds[eventId] = true;
  return { seenEventIds, seenEventOrder: nextOrder };
}

function trimChat(chat: ChatLine[]) {
  if (chat.length <= 500) return { chat };
  return { chat: chat.slice(chat.length - 500) };
}

function visualDiceFromPayload(
  payload: Record<string, unknown>,
): VisualDie[] | undefined {
  if (!Array.isArray(payload.rolls)) return undefined;
  const dice = payload.rolls
    .map((raw): VisualDie | null => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const record = raw as Record<string, unknown>;
      const sides = Number(record.die ?? record.sides);
      const value = Number(record.value);
      if (!Number.isFinite(sides) || !Number.isFinite(value)) return null;
      if (sides < 2 || value < 1) return null;
      return {
        sides,
        value,
        dropped: record.dropped === true ? true : undefined,
      };
    })
    .filter((die): die is VisualDie => Boolean(die));
  return dice.length > 0 ? dice : undefined;
}

function explorationTokensFromCharacters(input: {
  characters: SceneState["characters"] | undefined;
  currentTokens: Record<string, Token>;
  resetPositions: boolean;
}): Record<string, Token> {
  if (!input.characters?.length) return input.currentTokens;

  return Object.fromEntries(
    input.characters.map((character, index) => {
      const current = input.currentTokens[character.id];
      const useCurrentPosition = current && !input.resetPositions;
      const token: Token = {
        id: character.id,
        name: character.name,
        x: useCurrentPosition ? current.x : 2,
        y: useCurrentPosition ? current.y : Math.min(13, 2 + index),
        hp: current?.hp ?? 0,
        maxHp: current?.maxHp ?? 0,
        ac: current?.ac ?? 10,
        team: "player",
        movement: current?.movement,
        assetUrl: current?.assetUrl ?? character.portraitUrl ?? null,
        statuses: current?.statuses,
      };
      return [character.id, token] as const;
    }),
  );
}

function playerTokensFromCombat(
  tokens: Record<string, Token>,
): Record<string, Token> {
  return Object.fromEntries(
    Object.entries(tokens)
      .filter(([, token]) => token.team === "player")
      .map(([id, token]) => [id, { ...token, statuses: undefined }] as const),
  );
}

function updateTokenStatus(
  tokens: Record<string, Token>,
  tokenId: string,
  status: { condition: string; durationRounds?: number },
) {
  const token = tokens[tokenId];
  if (!token) return tokens;
  const condition = status.condition.toLowerCase();
  const existing = token.statuses ?? [];
  const filtered =
    condition === "dead"
      ? existing.filter(
          (item) =>
            item.condition.toLowerCase() !== "dead" &&
            item.condition.toLowerCase() !== "unconscious",
        )
      : existing.filter((item) => item.condition.toLowerCase() !== condition);
  return {
    ...tokens,
    [tokenId]: {
      ...token,
      statuses: [...filtered, status],
    },
  };
}

function combatOutcome(value: unknown): CombatState["outcome"] {
  if (value === "victory" || value === "defeat" || value === "fled") {
    return value;
  }
  return "unknown";
}

function gameOutcome(value: unknown): GameOverState["outcome"] {
  return value === "victory" || value === "defeat" ? value : "unknown";
}

function gameOverFromPayload(
  ev: ServerEvent,
  fallback: {
    outcome: GameOverState["outcome"];
    reason?: string | null;
    title: string;
    fallbackSummary?: string | null;
  },
): GameOverState {
  const outcome = gameOutcome(ev.payload.outcome);
  return {
    outcome: outcome === "unknown" ? fallback.outcome : outcome,
    reason: stringField(ev.payload.reason) ?? fallback.reason ?? null,
    title: stringField(ev.payload.title) ?? fallback.title,
    summary:
      stringField(ev.payload.summary) ?? fallback.fallbackSummary ?? null,
    defeatedTokenIds: stringArrayField(ev.payload.defeatedTokenIds),
    defeatedNames: stringArrayField(ev.payload.defeatedNames),
    ts: ev.ts,
  };
}

function sceneAssetMatches(scene: SceneState, refId: string | undefined) {
  return !refId || !scene.locationId || scene.locationId === refId;
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableStringField(value: unknown) {
  if (value == null) return null;
  return typeof value === "string" && value.trim() ? value : null;
}

function integerField(value: unknown) {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function nonNegativeIntegerField(value: unknown) {
  const number = integerField(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function movementEventMatchesActiveTurn(
  combat: CombatState,
  payload: Record<string, unknown>,
) {
  const round = integerField(payload.round);
  const turnIndex = integerField(payload.turnIndex);
  return (
    (round === undefined || round === (combat.round ?? 1)) &&
    (turnIndex === undefined || turnIndex === (combat.turnIndex ?? 0))
  );
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string");
  return list.length > 0 ? list : undefined;
}

function stringArrayField(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function npcList(value: unknown): SceneState["presentNpcs"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const id = stringField(obj.id);
    const name = stringField(obj.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        role: nullableStringField(obj.role),
        portraitUrl: nullableStringField(obj.portraitUrl),
      },
    ];
  });
  return list.length > 0 ? list : undefined;
}

function characterList(value: unknown): SceneState["characters"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const id = stringField(obj.id);
    const name = stringField(obj.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        className: nullableStringField(obj.className),
        race: nullableStringField(obj.race),
        portraitUrl: nullableStringField(obj.portraitUrl),
      },
    ];
  });
  return list.length > 0 ? list : undefined;
}

function introSequenceField(value: unknown): IntroSequenceState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const characterIntros = introCharacterList(obj.characterIntros);
  const setupBeats = normalizeOpeningBeats(obj.setupBeats);
  const nextActions = stringArrayField(obj.nextActions);
  const hasIntro =
    stringField(obj.establishingShot) ||
    setupBeats.length > 0 ||
    characterIntros.length > 0 ||
    stringField(obj.firstPrompt);
  if (!hasIntro) return null;

  return {
    title: stringField(obj.title),
    establishingShot: nullableStringField(obj.establishingShot),
    setupBeats,
    whyHere: nullableStringField(obj.whyHere),
    characterHookStyle: nullableStringField(obj.characterHookStyle),
    characterIntros,
    objective: nullableStringField(obj.objective),
    stakes: nullableStringField(obj.stakes),
    firstPrompt: nullableStringField(obj.firstPrompt),
    nextActions,
  };
}

function introCharacterList(
  value: unknown,
): IntroSequenceState["characterIntros"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const characterId = stringField(obj.characterId);
    const name = stringField(obj.name);
    if (!characterId || !name) return [];
    return [
      {
        characterId,
        name,
        summary: nullableStringField(obj.summary),
        prompt: nullableStringField(obj.prompt),
        text: nullableStringField(obj.text),
        portraitUrl: nullableStringField(obj.portraitUrl),
      },
    ];
  });
}
