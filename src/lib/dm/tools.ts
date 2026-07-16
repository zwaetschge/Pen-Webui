/**
 * DM tool registry.
 *
 * Each entry has:
 *   - schema (zod) — used to validate function-call arguments from the model
 *   - definition   — the JSONSchema served to OpenAI as a `ChatCompletionTool`
 *   - run(ctx,args)— execute the tool against the current game session/campaign,
 *                    return a string the model receives back, AND emit a
 *                    structured event for client UIs to react to.
 */

import { z } from "zod";
import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { prisma } from "../db";
import { rollDice } from "../dice";
import { searchSRD } from "../srd/search";
import { formatForTool } from "../srd/format";
import { createOrReuseCampaignAsset } from "../asset/library";
import { resolvePregeneratedAsset } from "../asset/pregenerated";
import { DEFAULT_TOKEN_MOVEMENT } from "../game/movement";
import { narrationStyleRejection } from "./narration-style";
import { GERMAN_STYLE_CONTRACT } from "./prompts";
import {
  loadPartyContext,
  partyStateForContext,
  persistPartyState,
  publishPartyEvent,
} from "../game/gameplay-api";
import { reducePartyState, type PartyCommand } from "../game/rules/party";
import { withSessionMutation } from "../game/session-mutation";

export type ToolEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type ToolCtx = {
  campaignId: string;
  sessionId: string;
  userId: string;
  emit: (event: ToolEvent) => void | Promise<void>;
};

export type ToolHandler = (ctx: ToolCtx, args: unknown) => Promise<string>;

// ─── schemas ────────────────────────────────────────────────────────────

const rollDiceArgs = z.object({
  notation: z.string().min(1),
  reason: z.string().optional(),
  hidden: z.boolean().optional(),
});

const narrateArgs = z.object({
  text: z.string().min(1),
  speakerNpcId: z.string().optional(),
  mood: z
    .enum(["neutral", "tense", "joyful", "menacing", "mysterious", "somber"])
    .optional(),
});

const lookupSrdArgs = z.object({
  query: z.string().min(1),
  type: z
    .enum([
      "spell",
      "monster",
      "rule",
      "item",
      "class",
      "race",
      "background",
      "feat",
      "condition",
      "feature",
    ])
    .optional(),
  limit: z.number().int().min(1).max(8).default(3),
});

const generateAssetArgs = z.object({
  kind: z.enum([
    "npc_portrait",
    "npc_token",
    "character_portrait",
    "character_token",
    "location_background",
    "location_tactical_map",
    "item_icon",
    "scene_keyframe",
  ]),
  refType: z.enum(["npc", "location", "item", "character", "scene"]),
  refId: z.string(),
  visualDescription: z.string().min(8),
});

const updateWorldStateArgs = z.object({
  patch: z.object({
    plotProgress: z.string().optional(),
    factionChanges: z
      .array(z.object({ name: z.string(), state: z.string() }))
      .optional(),
    worldFacts: z.array(z.string()).optional(),
    closedThreads: z.array(z.string()).optional(),
    newThreads: z.array(z.string()).optional(),
  }),
});

const managePartyArgs = z.object({
  action: z.enum([
    "grant_loot",
    "upsert_quest",
    "update_quest",
    "open_dialogue",
    "resolve_dialogue",
    "adjust_reputation",
    "set_flag",
  ]),
  holderId: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().int().min(1).default(1),
        equippableSlots: z.array(z.string()).default([]),
        usable: z.boolean().default(false),
        useEffect: z
          .object({
            resourceId: z.string().min(1),
            amount: z.number().int().min(1),
          })
          .optional(),
      }),
    )
    .optional(),
  quest: z
    .object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      status: z.enum(["inactive", "active", "completed", "failed"]),
      objectives: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.enum(["pending", "active", "completed", "failed"]),
          progress: z.number().int().min(0).default(0),
          target: z.number().int().min(1).default(1),
          optional: z.boolean().default(false),
        }),
      ),
    })
    .optional(),
  questId: z.string().optional(),
  questStatus: z.enum(["inactive", "active", "completed", "failed"]).optional(),
  objectiveId: z.string().optional(),
  objectiveStatus: z
    .enum(["pending", "active", "completed", "failed"])
    .optional(),
  progress: z.number().int().min(0).optional(),
  decision: z
    .object({
      id: z.string(),
      prompt: z.string(),
      participantIds: z.array(z.string()).min(1),
      speakerId: z.string(),
      resolutionMode: z.enum(["speaker", "majority"]).default("majority"),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          effects: z.array(z.record(z.unknown())).default([]),
        }),
      ),
    })
    .optional(),
  decisionId: z.string().optional(),
  optionId: z.string().optional(),
  memberId: z.string().optional(),
  checkOutcome: z
    .enum(["critical_failure", "failure", "success", "critical_success"])
    .optional(),
  factionId: z.string().optional(),
  amount: z.number().int().optional(),
  flagKey: z.string().optional(),
  flagValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
});

const startCombatArgs = z.object({
  name: z.string(),
  locationId: z.string().optional(),
  objective: z.string().min(3).optional(),
  surfaces: z
    .array(
      z.object({
        x: z.number().int().min(0).max(15),
        y: z.number().int().min(0).max(15),
        type: z.enum(["fire", "water", "ice", "lightning"]),
        intensity: z.number().int().min(1).max(3).default(1),
        duration: z.number().int().min(1).nullable().default(null),
      }),
    )
    .default([]),
  objects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["door", "barrel", "trap", "destructible"]),
        state: z.enum([
          "open",
          "closed",
          "locked",
          "intact",
          "armed",
          "disarmed",
          "triggered",
          "destroyed",
        ]),
        x: z.number().int().min(0).max(15),
        y: z.number().int().min(0).max(15),
        hp: z.number().int().min(0).default(10),
        maxHp: z.number().int().min(1).default(10),
        blocksMovement: z.boolean().default(false),
        blocksSight: z.boolean().default(false),
        armorClass: z.number().int().min(1).max(30).default(10),
        content: z.enum(["oil", "water", "volatile", "empty"]).optional(),
        detected: z.boolean().optional(),
        disarmDC: z.number().int().min(1).max(40).optional(),
        trapDamage: z.number().int().min(0).optional(),
        trapDamageType: z.string().optional(),
        trapCondition: z.string().optional(),
      }),
    )
    .default([]),
  participants: z.array(
    z.object({
      kind: z.enum(["npc", "character", "monster"]),
      refId: z.string().optional(),
      name: z.string(),
      hp: z.number().int().min(1),
      ac: z.number().int().min(1).max(40),
      initiativeMod: z.number().int().default(0),
      movement: z.number().int().min(0).max(20).optional(),
      attackBonus: z.number().int().min(-5).max(20).optional(),
      damageDice: z.string().min(2).max(40).optional(),
      damageType: z.string().min(3).max(20).optional(),
      attackRange: z.number().int().min(1).max(30).optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
    }),
  ),
});
type CombatParticipant = z.infer<
  typeof startCombatArgs
>["participants"][number];

const endCombatArgs = z.object({
  outcome: z.enum(["victory", "defeat", "fled", "negotiated"]),
  summary: z.string().min(4),
});

const setCombatTurnArgs = z
  .object({
    turnIndex: z.number().int().min(0).optional(),
    name: z.string().optional(),
    round: z.number().int().min(1).optional(),
  })
  .refine((a) => a.turnIndex !== undefined || Boolean(a.name?.trim()), {
    message: "Provide turnIndex or name.",
  });

const setSceneArgs = z.object({
  locationId: z.string(),
  beat: z.string().optional(),
});

const moveTokenArgs = z.object({
  tokenId: z.string(),
  x: z.number(),
  y: z.number(),
});

const applyDamageArgs = z.object({
  targetId: z.string(),
  amount: z.number().int().min(0),
  type: z
    .enum([
      "slashing",
      "piercing",
      "bludgeoning",
      "fire",
      "cold",
      "lightning",
      "thunder",
      "acid",
      "poison",
      "necrotic",
      "radiant",
      "psychic",
      "force",
    ])
    .optional(),
});

const applyStatusArgs = z.object({
  targetId: z.string(),
  condition: z.string(),
  durationRounds: z.number().int().min(0).optional(),
});

const requestSkillCheckArgs = z.object({
  characterId: z.string(),
  skill: z.string(),
  dc: z.number().int().min(1).max(40),
  reason: z.string().optional(),
});

const endSceneArgs = z.object({
  summary: z.string().min(8),
  nextSceneHint: z.string().optional(),
});

// ─── handlers ───────────────────────────────────────────────────────────

const rollDiceHandler: ToolHandler = async (ctx, raw) => {
  const a = rollDiceArgs.parse(raw);
  const result = rollDice(a.notation);
  await ctx.emit({
    type: "dice_roll",
    payload: {
      notation: a.notation,
      total: result.total,
      breakdown: result.breakdown,
      rolls: result.rolls,
      reason: a.reason,
      hidden: a.hidden ?? false,
      actor: "dm",
    },
  });
  return `Result: ${result.total}  (${a.notation} → ${result.breakdown})`;
};

const narrateHandler: ToolHandler = async (ctx, raw) => {
  const a = narrateArgs.parse(raw);
  const styleRejection = narrationStyleRejection(a.text);
  if (styleRejection) {
    return styleRejection;
  }

  let speakerName: string | null = null;
  let speakerPortrait: string | null = null;
  if (a.speakerNpcId) {
    const npc = await prisma.nPC.findFirst({
      where: { id: a.speakerNpcId, campaignId: ctx.campaignId },
      include: { portraitAsset: true },
    });
    if (npc) {
      speakerName = npc.name;
      speakerPortrait = npc.portraitAsset?.url ?? null;
      // First sighting reveals the NPC so future digests include them.
      if (npc.visibility !== "revealed") {
        await prisma.nPC.update({
          where: { id: npc.id },
          data: { visibility: "revealed" },
        });
      }
    }
  }
  await ctx.emit({
    type: "narrate",
    payload: {
      text: a.text,
      speakerNpcId: a.speakerNpcId ?? null,
      speakerName,
      speakerPortraitUrl: speakerPortrait,
      mood: a.mood ?? "neutral",
    },
  });
  return "narration delivered";
};

const lookupSrdHandler: ToolHandler = async (_ctx, raw) => {
  const a = lookupSrdArgs.parse(raw);
  const hits = await searchSRD({
    query: a.query,
    type: a.type,
    limit: a.limit,
  });
  if (hits.length === 0) {
    return `No SRD entries found for "${a.query}".`;
  }
  return hits.map(formatForTool).join("\n\n---\n\n");
};

const generateAssetHandler: ToolHandler = async (ctx, raw) => {
  const a = generateAssetArgs.parse(raw);
  const result = await createOrReuseCampaignAsset({
    campaignId: ctx.campaignId,
    kind: a.kind,
    prompt: a.visualDescription,
    refType: a.refType,
    refId: a.refId,
    description: a.visualDescription,
  });
  if (!result.asset) {
    return `No reusable asset found for ${a.kind}, and generation was not requested.`;
  }

  if (result.queued) {
    await ctx.emit({
      type: "asset_queued",
      payload: { assetId: result.asset.id, kind: a.kind, refId: a.refId },
    });
    return `Queued asset ${result.asset.id} (${a.kind}). It will appear when ready.`;
  }

  await ctx.emit({
    type: "asset_ready",
    payload: {
      assetId: result.asset.id,
      url: result.asset.url,
      kind: a.kind,
      refType: a.refType,
      refId: a.refId,
    },
  });
  return `Reused ${result.source} asset ${result.asset.id} (${a.kind}).`;
};

const updateWorldStateHandler: ToolHandler = async (ctx, raw) => {
  const a = updateWorldStateArgs.parse(raw);
  const world = await prisma.campaignWorld.findUnique({
    where: { campaignId: ctx.campaignId },
  });
  if (!world) return "World state not initialised for this campaign.";

  const facts = Array.isArray(world.worldFacts)
    ? [...(world.worldFacts as string[])]
    : [];
  if (a.patch.worldFacts) facts.push(...a.patch.worldFacts);

  const threads = Array.isArray(world.threads)
    ? [...(world.threads as string[])]
    : [];
  if (a.patch.newThreads) threads.push(...a.patch.newThreads);
  const closed = new Set(a.patch.closedThreads ?? []);
  const openThreads = threads.filter((t) => !closed.has(t));

  await prisma.campaignWorld.update({
    where: { campaignId: ctx.campaignId },
    data: {
      worldFacts: facts.slice(-200),
      threads: openThreads.slice(-100),
    },
  });

  await ctx.emit({
    type: "world_state_updated",
    payload: a.patch as Record<string, unknown>,
  });
  return "World state updated.";
};

const managePartyHandler: ToolHandler = async (ctx, raw) => {
  const input = managePartyArgs.parse(raw);
  return withSessionMutation(ctx.sessionId, async () => {
    const context = await loadPartyContext(ctx.sessionId);
    if (!context || context.endedAt) return "The session is not active.";
    const state = partyStateForContext(context);
    const commandId = `dm:${input.action}:${Date.now()}`;
    let command: PartyCommand;

    if (input.action === "grant_loot") {
      if (!input.items?.length) return "grant_loot requires at least one item.";
      command = {
        type: "inventory.loot",
        commandId,
        holderId: input.holderId ?? "party",
        items: input.items.map((item, index) => ({
          instanceId: `${commandId}:item:${index}`,
          definitionId: toolSlug(item.name),
          name: item.name,
          quantity: item.quantity,
          maxStack: 99,
          equippableSlots: item.equippableSlots,
          usable: item.usable,
          ...(item.useEffect
            ? {
                useEffect: {
                  type: "restore_resource" as const,
                  resourceId: item.useEffect.resourceId,
                  amount: item.useEffect.amount,
                },
              }
            : {}),
        })),
      };
    } else if (input.action === "upsert_quest") {
      if (!input.quest) return "upsert_quest requires quest.";
      command = {
        type: "quest.upsert",
        commandId,
        quest: {
          id: input.quest.id,
          title: input.quest.title,
          description: input.quest.description,
          status: input.quest.status,
          objectiveOrder: input.quest.objectives.map(
            (objective) => objective.id,
          ),
          objectives: Object.fromEntries(
            input.quest.objectives.map((objective) => [
              objective.id,
              { ...objective },
            ]),
          ),
        },
      };
    } else if (input.action === "update_quest") {
      if (!input.questId) return "update_quest requires questId.";
      command = input.objectiveId
        ? {
            type: "quest.setObjective",
            commandId,
            questId: input.questId,
            objectiveId: input.objectiveId,
            status: input.objectiveStatus,
            progress: input.progress,
          }
        : {
            type: "quest.setStatus",
            commandId,
            questId: input.questId,
            status: input.questStatus ?? "active",
          };
    } else if (input.action === "open_dialogue") {
      if (!input.decision) return "open_dialogue requires decision.";
      command = {
        type: "dialogue.open",
        commandId,
        decision: input.decision as Extract<
          PartyCommand,
          { type: "dialogue.open" }
        >["decision"],
      };
    } else if (input.action === "resolve_dialogue") {
      if (!input.decisionId || !input.memberId) {
        return "resolve_dialogue requires decisionId and memberId.";
      }
      command = {
        type: "dialogue.resolve",
        commandId,
        decisionId: input.decisionId,
        memberId: input.memberId,
        optionId: input.optionId,
        checkOutcome: input.checkOutcome,
      };
    } else if (input.action === "adjust_reputation") {
      if (!input.factionId || input.amount === undefined) {
        return "adjust_reputation requires factionId and amount.";
      }
      command = {
        type: "reputation.adjust",
        commandId,
        factionId: input.factionId,
        amount: input.amount,
      };
    } else {
      if (!input.flagKey || input.flagValue === undefined) {
        return "set_flag requires flagKey and flagValue.";
      }
      command = {
        type: "flag.set",
        commandId,
        key: input.flagKey,
        value: input.flagValue,
      };
    }

    const result = reducePartyState(state, command);
    if (!result.ok) return `Party update rejected: ${result.error.message}`;
    await persistPartyState(context, result.state);
    const access = {
      role: "host" as const,
      sessionId: ctx.sessionId,
      campaignId: ctx.campaignId,
      userId: ctx.userId,
      displayName: "Codex DM",
      memberId: `dm:${ctx.userId}`,
    };
    for (const event of result.events) {
      await publishPartyEvent(ctx.sessionId, event, result.state, access);
    }
    return `Party gameplay updated (${input.action}, revision ${result.state.revision}).`;
  });
};

const startCombatHandler: ToolHandler = async (ctx, raw) => {
  const a = startCombatArgs.parse(raw);
  const initiative = a.participants
    .map((p) => ({
      ...p,
      roll: rollDice(`1d20+${p.initiativeMod}`).total,
    }))
    .sort((x, y) => y.roll - x.roll);

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: ctx.campaignId,
      name: a.name,
      locationId: a.locationId,
      monsters: a.participants as never,
      initiative: initiative as never,
      status: "active",
      activeTurn: 0,
      round: 1,
      runtime: {
        version: 1,
        turnGroup: null,
        plans: {},
        reaction: null,
        statuses: {},
        surfaces: a.surfaces,
        objects: a.objects,
        visibility: {},
        objectives: a.objective
          ? [
              {
                id: "primary",
                label: a.objective,
                progress: 0,
                target: 1,
                status: "active",
              },
            ]
          : [],
      } as never,
    },
  });

  // Materialise tokens for the tactical map.  Auto-layout: monsters/npcs to
  // one side, characters to the other, in a tidy grid.
  const tokens = await Promise.all(
    a.participants.map(async (p, i) => {
      const team =
        p.kind === "character"
          ? "player"
          : p.kind === "npc"
            ? "npc"
            : "monster";
      const col = team === "player" ? 2 : 12;
      const row = 2 + i;
      return {
        id: p.refId ?? `tok_${encounter.id}_${i}`,
        name: p.name,
        x: typeof p.x === "number" ? p.x : col,
        y: typeof p.y === "number" ? p.y : row,
        hp: p.hp,
        maxHp: p.hp,
        ac: p.ac,
        team,
        movement: p.movement ?? DEFAULT_TOKEN_MOVEMENT,
        ...(p.attackBonus !== undefined
          ? { attackBonus: p.attackBonus }
          : p.kind === "monster"
            ? { attackBonus: 4 }
            : {}),
        ...(p.damageDice
          ? { damageDice: p.damageDice }
          : p.kind === "monster"
            ? { damageDice: "1d6+2" }
            : {}),
        ...(p.damageType
          ? { damageType: p.damageType }
          : p.kind === "monster"
            ? { damageType: "slashing" }
            : {}),
        ...(p.attackRange !== undefined
          ? { attackRange: p.attackRange }
          : p.kind === "monster"
            ? { attackRange: 1 }
            : {}),
        assetUrl: await resolveCombatTokenAsset(ctx, p),
      };
    }),
  );

  await ctx.emit({
    type: "combat_started",
    payload: {
      encounterId: encounter.id,
      name: a.name,
      initiative,
      tokens,
      surfaces: a.surfaces,
      objects: a.objects,
      objectives: a.objective
        ? [
            {
              id: "primary",
              label: a.objective,
              progress: 0,
              target: 1,
              status: "active",
            },
          ]
        : [],
    },
  });
  const playerGroup = initiative
    .slice(
      0,
      initiative.findIndex((entry) => entry.kind !== "character") < 0
        ? initiative.length
        : initiative.findIndex((entry) => entry.kind !== "character"),
    )
    .flatMap((entry) => {
      const token = tokens.find(
        (candidate) =>
          candidate.id === entry.refId || candidate.name === entry.name,
      );
      return token ? [token.id] : [];
    });
  if (playerGroup.length > 0) {
    await ctx.emit({
      type: "turn_group_set",
      payload: {
        encounterId: encounter.id,
        team: "player",
        tokenIds: playerGroup,
        completedTokenIds: [],
        round: 1,
        startIndex: 0,
        endIndex: playerGroup.length - 1,
      },
    });
  }
  return `Combat "${a.name}" started.  Initiative order:\n${initiative
    .map((p, i) => `  ${i + 1}. ${p.name} — ${p.roll}`)
    .join("\n")}`;
};

async function resolveCombatTokenAsset(
  ctx: ToolCtx,
  participant: CombatParticipant,
): Promise<string | null> {
  if (participant.kind === "monster") {
    return (
      resolvePregeneratedAsset({
        kind: "monster_token",
        name: [participant.name, participant.refId].filter(Boolean).join(" "),
      })?.url ?? null
    );
  }

  if (participant.kind === "npc") {
    const npc = participant.refId
      ? await prisma.nPC.findFirst({
          where: { id: participant.refId, campaignId: ctx.campaignId },
          include: { tokenAsset: true, portraitAsset: true },
        })
      : null;
    const pregen = resolvePregeneratedAsset({
      kind: "npc_token",
      name: participant.name,
      role: npc?.role ?? null,
      description: npc?.description ?? null,
    });
    return (
      npc?.tokenAsset?.url ?? pregen?.url ?? npc?.portraitAsset?.url ?? null
    );
  }

  if (!participant.refId) return null;
  const character = await prisma.character.findFirst({
    where: { id: participant.refId, campaignId: ctx.campaignId },
    include: { tokenAsset: true, portraitAsset: true },
  });
  return character?.tokenAsset?.url ?? character?.portraitAsset?.url ?? null;
}

const endCombatHandler: ToolHandler = async (ctx, raw) => {
  const a = endCombatArgs.parse(raw);
  const open = await prisma.encounter.findFirst({
    where: { campaignId: ctx.campaignId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  if (open) {
    await prisma.encounter.update({
      where: { id: open.id },
      data: { status: a.outcome === "fled" ? "fled" : "resolved" },
    });
  }
  await ctx.emit({
    type: "combat_ended",
    payload: {
      outcome: a.outcome,
      summary: a.summary,
      encounterId: open?.id ?? null,
    },
  });
  if (a.outcome === "defeat") {
    await ctx.emit({
      type: "party_defeated",
      payload: {
        encounterId: open?.id ?? null,
        summary: a.summary,
      },
    });
    await ctx.emit({
      type: "game_over",
      payload: {
        encounterId: open?.id ?? null,
        outcome: "defeat",
        reason: "party_defeated",
        title: "Game Over",
        summary: a.summary,
      },
    });
    await prisma.gameSession.updateMany({
      where: { id: ctx.sessionId, endedAt: null },
      data: {
        endedAt: new Date(),
        summary: `Game Over: ${a.summary}`,
      },
    });
    await ctx.emit({
      type: "session_ended",
      payload: {
        outcome: "defeat",
        reason: "party_defeated",
        summary: a.summary,
      },
    });
  }
  return `Combat closed (${a.outcome}). Tactical view dropped.`;
};

const setSceneHandler: ToolHandler = async (ctx, raw) => {
  const a = setSceneArgs.parse(raw);
  const loc = await prisma.location.findFirst({
    where: { id: a.locationId, campaignId: ctx.campaignId },
    include: { backgroundAsset: true, tacticalMapAsset: true },
  });
  if (!loc) return `Unknown location ${a.locationId}.`;
  await ctx.emit({
    type: "scene_set",
    payload: {
      locationId: loc.id,
      locationName: loc.name,
      locationDescription: loc.description,
      backgroundUrl: loc.backgroundAsset?.url ?? null,
      tacticalMapUrl: loc.tacticalMapAsset?.url ?? null,
      gridConfig: loc.gridConfig ?? null,
      beat: a.beat ?? null,
    },
  });
  return `Scene moved to ${loc.name}.`;
};

const setCombatTurnHandler: ToolHandler = async (ctx, raw) => {
  const a = setCombatTurnArgs.parse(raw);
  const open = await prisma.encounter.findFirst({
    where: { campaignId: ctx.campaignId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  if (!open) return "No active combat encounter.";

  const initiative = Array.isArray(open.initiative)
    ? (open.initiative as Array<Record<string, unknown>>)
    : [];
  let turnIndex = a.turnIndex;
  if (turnIndex === undefined && a.name) {
    const target = normalizeName(a.name);
    const exact = initiative.findIndex(
      (entry) => normalizeName(String(entry.name ?? "")) === target,
    );
    const partial =
      exact >= 0
        ? exact
        : initiative.findIndex((entry) =>
            normalizeName(String(entry.name ?? "")).includes(target),
          );
    if (partial >= 0) turnIndex = partial;
  }

  if (turnIndex === undefined) {
    return `Could not find ${a.name ?? "combatant"} in initiative.`;
  }

  const maxIndex = Math.max(0, initiative.length - 1);
  const nextTurnIndex = Math.max(0, Math.min(maxIndex, turnIndex));
  const nextRound = a.round ?? open.round ?? 1;
  const active = initiative[nextTurnIndex] ?? null;
  const activeName =
    typeof active?.name === "string" && active.name.trim()
      ? active.name
      : (a.name ?? `turn ${nextTurnIndex + 1}`);

  await prisma.encounter.update({
    where: { id: open.id },
    data: { activeTurn: nextTurnIndex, round: nextRound },
  });

  await ctx.emit({
    type: "combat_turn_set",
    payload: {
      encounterId: open.id,
      turnIndex: nextTurnIndex,
      round: nextRound,
      name: activeName,
    },
  });

  return `Combat turn set to ${activeName} (round ${nextRound}).`;
};

const moveTokenHandler: ToolHandler = async (ctx, raw) => {
  const a = moveTokenArgs.parse(raw);
  await ctx.emit({
    type: "token_moved",
    payload: a as Record<string, unknown>,
  });
  return `Token ${a.tokenId} moved to (${a.x}, ${a.y}).`;
};

const applyDamageHandler: ToolHandler = async (ctx, raw) => {
  const a = applyDamageArgs.parse(raw);
  await ctx.emit({
    type: "damage_applied",
    payload: a as Record<string, unknown>,
  });
  return `${a.amount}${a.type ? " " + a.type : ""} damage applied to ${a.targetId}.`;
};

const applyStatusHandler: ToolHandler = async (ctx, raw) => {
  const a = applyStatusArgs.parse(raw);
  await ctx.emit({
    type: "status_applied",
    payload: a as Record<string, unknown>,
  });
  return `${a.condition} applied to ${a.targetId}${
    a.durationRounds ? ` for ${a.durationRounds} rounds` : ""
  }.`;
};

const requestSkillCheckHandler: ToolHandler = async (ctx, raw) => {
  const a = requestSkillCheckArgs.parse(raw);
  await ctx.emit({
    type: "skill_check_requested",
    payload: a as Record<string, unknown>,
  });
  return `Skill check requested: ${a.skill} DC ${a.dc} from character ${a.characterId}.  Waiting for player roll.`;
};

const endSceneHandler: ToolHandler = async (ctx, raw) => {
  const a = endSceneArgs.parse(raw);
  await ctx.emit({
    type: "scene_ended",
    payload: a as Record<string, unknown>,
  });
  return "Scene closed.  Next scene queued.";
};

// ─── registry ───────────────────────────────────────────────────────────

export const dmTools: Record<
  string,
  { definition: ChatCompletionTool; run: ToolHandler }
> = {
  narrate: {
    definition: {
      type: "function",
      function: {
        name: "narrate",
        description:
          "Deliver narrative prose to the players. Use for descriptions, NPC dialogue, scene-setting. Keep paragraphs short and evocative.\n" +
          GERMAN_STYLE_CONTRACT,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1 },
            speakerNpcId: {
              type: "string",
              description:
                "if an NPC is speaking, their ID — pulls up their portrait",
            },
            mood: {
              type: "string",
              enum: [
                "neutral",
                "tense",
                "joyful",
                "menacing",
                "mysterious",
                "somber",
              ],
            },
          },
          required: ["text"],
        },
      },
    },
    run: narrateHandler,
  },

  roll_dice: {
    definition: {
      type: "function",
      function: {
        name: "roll_dice",
        description:
          "Roll dice using standard notation (e.g. 2d6+3, 1d20adv, 4d6dl1). Use for DM-side rolls — attack rolls, saves, random tables. Player-side rolls go via request_skill_check.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            notation: { type: "string", minLength: 1 },
            reason: { type: "string" },
            hidden: {
              type: "boolean",
              description:
                "if true, players see only the outcome, not the roll",
            },
          },
          required: ["notation"],
        },
      },
    },
    run: rollDiceHandler,
  },

  lookup_srd: {
    definition: {
      type: "function",
      function: {
        name: "lookup_srd",
        description:
          "Look up rules, spells, monsters, items, classes, races, conditions, or features in the official D&D 5.1 SRD. You MUST call this when you need exact numerical mechanics (damage, DC, range, casting time, HP, AC).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            type: {
              type: "string",
              enum: [
                "spell",
                "monster",
                "rule",
                "item",
                "class",
                "race",
                "background",
                "feat",
                "condition",
                "feature",
              ],
            },
            limit: { type: "integer", minimum: 1, maximum: 8 },
          },
          required: ["query"],
        },
      },
    },
    run: lookupSrdHandler,
  },

  generate_asset: {
    definition: {
      type: "function",
      function: {
        name: "generate_asset",
        description:
          "Queue generation of a visual asset (portrait, token, location background, etc.). The image will appear in-game when ready; you don't wait for it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: [
                "npc_portrait",
                "npc_token",
                "character_portrait",
                "character_token",
                "location_background",
                "location_tactical_map",
                "item_icon",
                "scene_keyframe",
              ],
            },
            refType: {
              type: "string",
              enum: ["npc", "location", "item", "character", "scene"],
            },
            refId: { type: "string" },
            visualDescription: {
              type: "string",
              description:
                "Concrete visual description (subject, composition, mood, lighting). Style suffix is appended by the worker.",
            },
          },
          required: ["kind", "refType", "refId", "visualDescription"],
        },
      },
    },
    run: generateAssetHandler,
  },

  update_world_state: {
    definition: {
      type: "function",
      function: {
        name: "update_world_state",
        description:
          "Persist canonical world changes (plot progress, faction shifts, new facts, threads opened/closed). Use whenever a non-trivial event happens so future turns remember it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            patch: {
              type: "object",
              properties: {
                plotProgress: { type: "string" },
                factionChanges: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      state: { type: "string" },
                    },
                    required: ["name", "state"],
                  },
                },
                worldFacts: { type: "array", items: { type: "string" } },
                closedThreads: { type: "array", items: { type: "string" } },
                newThreads: { type: "array", items: { type: "string" } },
              },
            },
          },
          required: ["patch"],
        },
      },
    },
    run: updateWorldStateHandler,
  },

  manage_party: {
    definition: {
      type: "function",
      function: {
        name: "manage_party",
        description:
          "Update deterministic party gameplay: grant loot, create/update quests, open/resolve cooperative dialogue votes, record flags, or adjust reputation. Use this whenever narration changes party-owned state.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: {
              type: "string",
              enum: [
                "grant_loot",
                "upsert_quest",
                "update_quest",
                "open_dialogue",
                "resolve_dialogue",
                "adjust_reputation",
                "set_flag",
              ],
            },
            holderId: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                  equippableSlots: {
                    type: "array",
                    items: { type: "string" },
                  },
                  usable: { type: "boolean" },
                  useEffect: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      resourceId: { type: "string" },
                      amount: { type: "integer", minimum: 1 },
                    },
                    required: ["resourceId", "amount"],
                  },
                },
                required: ["name"],
              },
            },
            quest: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                status: {
                  type: "string",
                  enum: ["inactive", "active", "completed", "failed"],
                },
                objectives: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      status: {
                        type: "string",
                        enum: ["pending", "active", "completed", "failed"],
                      },
                      progress: { type: "integer", minimum: 0 },
                      target: { type: "integer", minimum: 1 },
                      optional: { type: "boolean" },
                    },
                    required: ["id", "title", "status"],
                  },
                },
              },
              required: ["id", "title", "status", "objectives"],
            },
            questId: { type: "string" },
            questStatus: {
              type: "string",
              enum: ["inactive", "active", "completed", "failed"],
            },
            objectiveId: { type: "string" },
            objectiveStatus: {
              type: "string",
              enum: ["pending", "active", "completed", "failed"],
            },
            progress: { type: "integer", minimum: 0 },
            decision: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                prompt: { type: "string" },
                participantIds: {
                  type: "array",
                  items: { type: "string" },
                },
                speakerId: { type: "string" },
                resolutionMode: {
                  type: "string",
                  enum: ["speaker", "majority"],
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                      effects: {
                        type: "array",
                        items: { type: "object" },
                      },
                    },
                    required: ["id", "label"],
                  },
                },
              },
              required: [
                "id",
                "prompt",
                "participantIds",
                "speakerId",
                "options",
              ],
            },
            decisionId: { type: "string" },
            optionId: { type: "string" },
            memberId: { type: "string" },
            checkOutcome: {
              type: "string",
              enum: [
                "critical_failure",
                "failure",
                "success",
                "critical_success",
              ],
            },
            factionId: { type: "string" },
            amount: { type: "integer" },
            flagKey: { type: "string" },
            flagValue: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
                { type: "null" },
              ],
            },
          },
          required: ["action"],
        },
      },
    },
    run: managePartyHandler,
  },

  start_combat: {
    definition: {
      type: "function",
      function: {
        name: "start_combat",
        description:
          "Start a tactical combat encounter. Switches the client to tactical view, rolls initiative, and places tokens on the grid.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            locationId: { type: "string" },
            objective: {
              type: "string",
              description:
                "Concrete win or scene objective shown on the big screen.",
            },
            surfaces: {
              type: "array",
              description:
                "Useful elemental surfaces already present on the map.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  x: { type: "integer", minimum: 0, maximum: 15 },
                  y: { type: "integer", minimum: 0, maximum: 15 },
                  type: {
                    type: "string",
                    enum: ["fire", "water", "ice", "lightning"],
                  },
                  intensity: { type: "integer", minimum: 1, maximum: 3 },
                  duration: {
                    anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
                  },
                },
                required: ["x", "y", "type"],
              },
            },
            objects: {
              type: "array",
              description:
                "Doors, barrels, traps, and destructibles that create tactical choices.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["door", "barrel", "trap", "destructible"],
                  },
                  state: {
                    type: "string",
                    enum: [
                      "open",
                      "closed",
                      "locked",
                      "intact",
                      "armed",
                      "disarmed",
                      "triggered",
                      "destroyed",
                    ],
                  },
                  x: { type: "integer", minimum: 0, maximum: 15 },
                  y: { type: "integer", minimum: 0, maximum: 15 },
                  hp: { type: "integer", minimum: 0 },
                  maxHp: { type: "integer", minimum: 1 },
                  blocksMovement: { type: "boolean" },
                  blocksSight: { type: "boolean" },
                  armorClass: { type: "integer", minimum: 1, maximum: 30 },
                  content: {
                    type: "string",
                    enum: ["oil", "water", "volatile", "empty"],
                  },
                  detected: { type: "boolean" },
                  disarmDC: { type: "integer", minimum: 1, maximum: 40 },
                  trapDamage: { type: "integer", minimum: 0 },
                  trapDamageType: { type: "string" },
                  trapCondition: { type: "string" },
                },
                required: ["id", "name", "kind", "state", "x", "y"],
              },
            },
            participants: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: {
                    type: "string",
                    enum: ["npc", "character", "monster"],
                  },
                  refId: { type: "string" },
                  name: { type: "string" },
                  hp: { type: "integer", minimum: 1 },
                  ac: { type: "integer", minimum: 1, maximum: 40 },
                  initiativeMod: { type: "integer" },
                  movement: {
                    type: "integer",
                    minimum: 0,
                    maximum: 20,
                    description:
                      "grid movement allowance for this combatant; default is 6",
                  },
                  attackBonus: {
                    type: "integer",
                    minimum: -5,
                    maximum: 20,
                    description:
                      "optional to-hit bonus for direct tactical attacks",
                  },
                  damageDice: {
                    type: "string",
                    description:
                      "optional damage notation for direct tactical attacks, e.g. 1d6+2",
                  },
                  damageType: {
                    type: "string",
                    description: "optional damage type, e.g. slashing",
                  },
                  attackRange: {
                    type: "integer",
                    minimum: 1,
                    maximum: 30,
                    description: "attack range in grid squares; default is 1",
                  },
                  x: {
                    type: "integer",
                    description: "grid x of starting position (optional)",
                  },
                  y: {
                    type: "integer",
                    description: "grid y of starting position (optional)",
                  },
                },
                required: ["kind", "name", "hp", "ac"],
              },
            },
          },
          required: ["name", "participants"],
        },
      },
    },
    run: startCombatHandler,
  },

  end_combat: {
    definition: {
      type: "function",
      function: {
        name: "end_combat",
        description:
          "Close the active combat encounter. Drops the tactical view and emits a closing narration prompt.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            outcome: {
              type: "string",
              enum: ["victory", "defeat", "fled", "negotiated"],
            },
            summary: { type: "string", minLength: 4 },
          },
          required: ["outcome", "summary"],
        },
      },
    },
    run: endCombatHandler,
  },

  set_combat_turn: {
    definition: {
      type: "function",
      function: {
        name: "set_combat_turn",
        description:
          "Set the active initiative turn during combat. Call whenever the turn passes to another combatant or a new round begins.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            turnIndex: {
              type: "integer",
              minimum: 0,
              description: "zero-based initiative index, if known",
            },
            name: {
              type: "string",
              description:
                "combatant name to match in initiative, if turnIndex is unknown",
            },
            round: {
              type: "integer",
              minimum: 1,
              description: "current combat round",
            },
          },
        },
      },
    },
    run: setCombatTurnHandler,
  },

  set_scene: {
    definition: {
      type: "function",
      function: {
        name: "set_scene",
        description:
          "Switch the cinematic backdrop to a specific location. Use whenever the party moves to a new place so the players see the right view.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            locationId: { type: "string" },
            beat: {
              type: "string",
              description:
                "short label for this beat (e.g. 'after midnight', 'after the fire')",
            },
          },
          required: ["locationId"],
        },
      },
    },
    run: setSceneHandler,
  },

  move_token: {
    definition: {
      type: "function",
      function: {
        name: "move_token",
        description:
          "Move a token on the tactical map. Use during combat to animate enemy or NPC movement.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            tokenId: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["tokenId", "x", "y"],
        },
      },
    },
    run: moveTokenHandler,
  },

  apply_damage: {
    definition: {
      type: "function",
      function: {
        name: "apply_damage",
        description:
          "Apply damage to a combatant. The client subtracts from HP and animates the hit.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            targetId: { type: "string" },
            amount: { type: "integer", minimum: 0 },
            type: {
              type: "string",
              enum: [
                "slashing",
                "piercing",
                "bludgeoning",
                "fire",
                "cold",
                "lightning",
                "thunder",
                "acid",
                "poison",
                "necrotic",
                "radiant",
                "psychic",
                "force",
              ],
            },
          },
          required: ["targetId", "amount"],
        },
      },
    },
    run: applyDamageHandler,
  },

  apply_status: {
    definition: {
      type: "function",
      function: {
        name: "apply_status",
        description:
          "Apply or remove a condition (poisoned, prone, blinded, …).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            targetId: { type: "string" },
            condition: { type: "string" },
            durationRounds: { type: "integer", minimum: 0 },
          },
          required: ["targetId", "condition"],
        },
      },
    },
    run: applyStatusHandler,
  },

  request_skill_check: {
    definition: {
      type: "function",
      function: {
        name: "request_skill_check",
        description:
          "Ask a player to make a skill check. Pauses the turn loop until they roll.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string" },
            skill: { type: "string" },
            dc: { type: "integer", minimum: 1, maximum: 40 },
            reason: { type: "string" },
          },
          required: ["characterId", "skill", "dc"],
        },
      },
    },
    run: requestSkillCheckHandler,
  },

  end_scene: {
    definition: {
      type: "function",
      function: {
        name: "end_scene",
        description:
          "Close the current scene and provide a summary. The orchestrator uses this for memory compaction.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string", minLength: 8 },
            nextSceneHint: { type: "string" },
          },
          required: ["summary"],
        },
      },
    },
    run: endSceneHandler,
  },
};

export function allToolDefinitions(): ChatCompletionTool[] {
  return Object.values(dmTools).map((t) => t.definition);
}

export async function runToolCall(
  ctx: ToolCtx,
  call: ChatCompletionMessageToolCall,
): Promise<string> {
  const name = call.function.name;
  const tool = dmTools[name];
  if (!tool) return `Unknown tool: ${name}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments || "{}");
  } catch {
    return `Bad JSON arguments to ${name}.`;
  }

  try {
    return await tool.run(ctx, parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Tool ${name} failed: ${msg}`;
  }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function toolSlug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}
