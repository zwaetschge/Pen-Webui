import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rollDice } from "@/lib/dice";
import { resolveAccess, type SessionAccess } from "./access";
import { publishEvent, type GameEventScope } from "./bus";
import { normalizeEncounterRuntime } from "./encounter-runtime";
import {
  createPartyState,
  dialogueViewFor,
  normalizePartyState,
  reducePartyState,
  type PartyCommand,
  type PartyDomainEvent,
  type PartyRuntimeState,
} from "./rules/party";
import { withSessionMutation } from "./session-mutation";
import { abilitiesForSheet } from "./rules/combat";
import { activeCombatStateForSession } from "./tactical-state";

const commandEnvelopeSchema = z
  .object({
    type: z.string().min(1).max(80),
    commandId: z.string().min(8).max(160),
  })
  .passthrough();

const dialogueRollSchema = z.object({
  type: z.literal("dialogue.rollAndResolve"),
  commandId: z.string().min(8).max(160),
  decisionId: z.string().min(1).max(160),
  memberId: z.string().min(1).max(160),
  optionId: z.string().min(1).max(160),
});

type Access = NonNullable<SessionAccess>;

export async function handleGameplayState(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const access = await gameplayAccess(req, sessionId, inviteTokenOverride);
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const context = await loadPartyContext(sessionId);
  if (!context || context.endedAt) {
    return NextResponse.json({ error: "session_closed" }, { status: 410 });
  }
  const state = partyStateForContext(context);
  const encounter = context.campaign.encounters[0] ?? null;
  return NextResponse.json({
    ok: true,
    actorCharacterId: playerCharacterId(access),
    party: partyViewFor(state, access),
    characters: context.campaign.characters
      .filter(
        (character) =>
          access.role === "host" || character.id === access.characterId,
      )
      .map((character) => ({
        id: character.id,
        name: character.name,
        abilities: abilitiesForSheet(character.sheet),
        runtime: character.runtime,
      })),
    encounter: encounter
      ? {
          id: encounter.id,
          round: encounter.round,
          activeTurn: encounter.activeTurn,
          runtime: encounterViewFor(
            normalizeEncounterRuntime(encounter.runtime),
            access,
          ),
        }
      : null,
  });
}

export async function handleGameplayCommand(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const access = await gameplayAccess(req, sessionId, inviteTokenOverride);
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = commandEnvelopeSchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  return withSessionMutation(sessionId, async () => {
    const context = await loadPartyContext(sessionId);
    if (!context || context.endedAt) {
      return NextResponse.json({ error: "session_closed" }, { status: 410 });
    }
    const state = partyStateForContext(context);
    let serverResolvedCheck = false;
    let checkRoll: {
      notation: string;
      total: number;
      natural: number;
      modifier: number;
      outcome: "critical_failure" | "failure" | "success" | "critical_success";
      checkerId: string;
      skill: string;
      dc: number;
    } | null = null;
    let command: PartyCommand;

    if (parsed.data.type === "dialogue.rollAndResolve") {
      const special = dialogueRollSchema.safeParse(parsed.data);
      if (!special.success) {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }
      if (state.processedCommands[special.data.commandId] !== undefined) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          party: partyViewFor(state, access),
        });
      }
      const decision = state.dialogues[special.data.decisionId];
      const option = decision?.options[special.data.optionId];
      if (!decision || decision.status !== "open" || !option?.check) {
        return NextResponse.json(
          { error: "dialogue_check_not_found" },
          { status: 404 },
        );
      }
      const assignment = decision.checkAssignments[option.id];
      const checkerId = assignment?.memberId ?? decision.speakerId;
      const checker = context.campaign.characters.find(
        (character) => character.id === checkerId,
      );
      if (!checker) {
        return NextResponse.json(
          { error: "checker_not_found" },
          { status: 422 },
        );
      }
      const modifier = dialogueSkillModifier(checker.sheet, option.check.skill);
      const assisted = (assignment?.assistants.length ?? 0) > 0;
      const notation = `1d20${assisted ? "adv" : ""}${signedModifier(modifier)}`;
      const roll = rollDice(notation);
      const natural =
        roll.groups[0]?.kept[0] ?? Math.max(1, roll.total - modifier);
      const outcome = dialogueCheckOutcome(
        natural,
        roll.total,
        option.check.dc,
      );
      checkRoll = {
        notation,
        total: roll.total,
        natural,
        modifier,
        outcome,
        checkerId,
        skill: option.check.skill,
        dc: option.check.dc,
      };
      command = {
        type: "dialogue.resolve",
        commandId: special.data.commandId,
        decisionId: special.data.decisionId,
        memberId: special.data.memberId,
        optionId: special.data.optionId,
        checkOutcome: outcome,
      };
      serverResolvedCheck = true;
    } else {
      command = parsed.data as unknown as PartyCommand;
    }

    if (!partyCommandAuthorized(access, command, state, serverResolvedCheck)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let combatHealing: { tokenId: string; sourceItemId: string } | null = null;
    if (command.type === "inventory.use") {
      const item = state.inventory[command.itemId];
      if (item?.useEffect?.resourceId === "health") {
        const combat = await activeCombatStateForSession(sessionId);
        const token = combat?.tokens.find(
          (candidate) => candidate.id === command.memberId,
        );
        if (token) {
          if ((token.hp ?? 0) <= 0) {
            return NextResponse.json(
              { error: "character_downed" },
              { status: 409 },
            );
          }
          const health = state.resources[command.memberId]?.health;
          if (health) {
            health.current = Math.max(0, Math.floor(token.hp ?? 0));
            health.max = Math.max(
              health.current,
              Math.floor(token.maxHp ?? health.max),
            );
          }
          combatHealing = { tokenId: token.id, sourceItemId: item.instanceId };
        }
      }
    }

    let result;
    try {
      result = reducePartyState(state, command);
    } catch (error) {
      return NextResponse.json(
        {
          error: "unsupported_state",
          message: error instanceof Error ? error.message : "invalid state",
        },
        { status: 409 },
      );
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error.code, message: result.error.message },
        { status: partyRuleStatus(result.error.code) },
      );
    }

    if (!result.duplicate) {
      await persistPartyState(context, result.state);
      if (combatHealing) {
        const restored = result.events.find(
          (event) =>
            event.type === "resource_restored" &&
            event.payload.memberId === combatHealing?.tokenId &&
            event.payload.resourceId === "health",
        );
        const amount = Number(restored?.payload.amount ?? 0);
        if (Number.isFinite(amount) && amount > 0) {
          await publishEvent(sessionId, "healing_applied", {
            targetId: combatHealing.tokenId,
            amount,
            sourceItemId: combatHealing.sourceItemId,
            sourceName: "Verbrauchsgegenstand",
          });
        }
      }
      if (checkRoll) {
        const checker = context.campaign.characters.find(
          (character) => character.id === checkRoll?.checkerId,
        );
        await publishEvent(sessionId, "dice_roll", {
          notation: checkRoll.notation,
          total: checkRoll.total,
          reason: `${checkRoll.skill} · SG ${checkRoll.dc}`,
          actor: "player",
          displayName: checker?.name ?? checkRoll.checkerId,
          characterId: checkRoll.checkerId,
          checkOutcome: checkRoll.outcome,
        });
      }
      for (const event of result.events) {
        await publishPartyEvent(sessionId, event, result.state, access);
      }
    }

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      party: partyViewFor(result.state, access),
      check: checkRoll,
    });
  });
}

async function gameplayAccess(
  req: Request,
  sessionId: string,
  override?: string | null,
) {
  const inviteToken =
    override !== undefined
      ? override
      : new URL(req.url).searchParams.get("token");
  return resolveAccess({ sessionId, inviteToken });
}

export async function loadPartyContext(sessionId: string) {
  return prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      campaignId: true,
      endedAt: true,
      runtime: true,
      campaign: {
        select: {
          world: { select: { gameState: true } },
          characters: {
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, sheet: true, runtime: true },
          },
          encounters: {
            where: { status: "active" },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              round: true,
              activeTurn: true,
              runtime: true,
            },
          },
        },
      },
    },
  });
}

export type PartyContext = NonNullable<
  Awaited<ReturnType<typeof loadPartyContext>>
>;

export function partyStateForContext(context: PartyContext): PartyRuntimeState {
  const sessionRuntime = record(context.runtime);
  const campaignRuntime = record(context.campaign.world?.gameState);
  const raw = sessionRuntime.partyState ?? campaignRuntime.partyState;
  const fresh = !record(raw).version;
  const state = raw
    ? normalizePartyState(raw)
    : createPartyState(
        context.campaign.characters.map((character) => ({
          id: character.id,
          name: character.name,
        })),
      );

  for (const character of context.campaign.characters) {
    state.members[character.id] = {
      id: character.id,
      name: character.name,
      active: true,
    };
    state.equipment[character.id] ??= {};
    state.resources[character.id] ??= {};
    if (fresh) seedCharacterPartyState(state, character);
  }
  return state;
}

function seedCharacterPartyState(
  state: PartyRuntimeState,
  character: PartyContext["campaign"]["characters"][number],
) {
  const sheet = record(character.sheet);
  const hpMax = positiveInteger(sheet.hpMax) ?? 10;
  state.resources[character.id].health = {
    id: "health",
    label: "Trefferpunkte",
    kind: "health",
    current: Math.min(hpMax, nonNegativeInteger(sheet.hpCurrent) ?? hpMax),
    max: hpMax,
    resetOn: "long",
  };

  const spells = Array.isArray(sheet.spells) ? sheet.spells : [];
  const maxSpellLevel = spells.reduce((highest, raw) => {
    const spell = record(raw);
    return Math.max(highest, nonNegativeInteger(spell.level) ?? 0);
  }, 0);
  const characterLevel = positiveInteger(sheet.level) ?? 1;
  for (let level = 1; level <= maxSpellLevel; level += 1) {
    const maximum = Math.max(1, Math.min(4, characterLevel + 1 - level));
    state.resources[character.id][`spell-slot-${level}`] = {
      id: `spell-slot-${level}`,
      label: `Zauberplatz ${level}`,
      kind: "spell_slot",
      current: maximum,
      max: maximum,
      resetOn: "long",
      level,
    };
  }

  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory : [];
  inventory.forEach((raw, index) => {
    const item = record(raw);
    const name = cleanString(item.name);
    if (!name) return;
    const instanceId = `sheet:${character.id}:${index}`;
    const restorative = /heiltrank|healing potion|potion of healing/i.test(
      name,
    );
    state.inventory[instanceId] = {
      instanceId,
      definitionId: slug(name),
      name,
      holderId: character.id,
      quantity: positiveInteger(item.qty) ?? 1,
      maxStack: 99,
      equippableSlots: inferEquipmentSlots(name),
      usable: /trank|potion|elixir|scroll|rolle/i.test(name),
      ...(restorative
        ? {
            useEffect: {
              type: "restore_resource" as const,
              resourceId: "health",
              amount: 7,
            },
          }
        : {}),
    };
  });
}

export async function persistPartyState(
  context: PartyContext,
  state: PartyRuntimeState,
) {
  const sessionRuntime = {
    ...record(context.runtime),
    version: 1,
    partyState: state,
  };
  const campaignGameState = {
    ...record(context.campaign.world?.gameState),
    version: 1,
    partyState: state,
  };
  await prisma.$transaction([
    prisma.gameSession.update({
      where: { id: context.id },
      data: { runtime: sessionRuntime as never },
    }),
    prisma.campaignWorld.updateMany({
      where: { campaignId: context.campaignId },
      data: { gameState: campaignGameState as never },
    }),
  ]);
}

function partyCommandAuthorized(
  access: Access,
  command: PartyCommand,
  state: PartyRuntimeState,
  serverResolvedCheck = false,
) {
  if (access.role === "host") return true;
  const actorId = access.characterId;
  if (!actorId || !state.members[actorId]?.active) return false;

  switch (command.type) {
    case "inventory.transfer": {
      const item = state.inventory[command.itemId];
      return Boolean(
        item && (item.holderId === actorId || item.holderId === "party"),
      );
    }
    case "inventory.equip":
    case "inventory.unequip":
    case "inventory.use":
    case "resource.spend":
      return command.memberId === actorId;
    case "resource.restore":
      // Recovery is granted only by server-owned effects (items, rests, DM
      // tools). Accepting this command from a player would allow free healing
      // and spell-slot restoration.
      return false;
    case "rest.propose":
      return command.proposerId === actorId;
    case "rest.vote":
      return command.memberId === actorId;
    case "rest.cancel":
      return command.memberId === actorId;
    case "dialogue.setSpeaker":
      return command.speakerId === actorId;
    case "dialogue.vote":
    case "dialogue.assist":
      return command.memberId === actorId;
    case "dialogue.delegateCheck":
      return command.delegatorId === actorId;
    case "dialogue.resolve": {
      if (command.memberId !== actorId) return false;
      const decision = state.dialogues[command.decisionId];
      const optionId =
        command.optionId ?? decision?.votes[command.memberId]?.optionId;
      const checked = optionId
        ? Boolean(decision?.options[optionId]?.check)
        : false;
      return !checked || serverResolvedCheck;
    }
    case "dialogue.cancel":
      return command.memberId === actorId;
    default:
      return false;
  }
}

export function dialogueCheckOutcome(
  natural: number,
  total: number,
  dc: number,
): "critical_failure" | "failure" | "success" | "critical_success" {
  if (natural === 1) return "critical_failure";
  if (natural === 20) return "critical_success";
  return total >= dc ? "success" : "failure";
}

export function dialogueSkillModifier(sheetValue: unknown, skill: string) {
  const sheet = record(sheetValue);
  const skills = record(sheet.skills);
  const key = Object.keys(skills).find(
    (candidate) => candidate.toLowerCase() === skill.trim().toLowerCase(),
  );
  const trained = key ? skills[key] : undefined;
  if (typeof trained === "number" && Number.isFinite(trained)) {
    return Math.floor(trained);
  }
  const ability = skillAbility(skill);
  const scores = record(sheet.abilities);
  const score = integer(scores[ability]) ?? 10;
  const abilityModifier = Math.floor((score - 10) / 2);
  const proficiency = Math.max(0, integer(sheet.proficiencyBonus) ?? 2);
  const multiplier =
    trained === "expert" ? 2 : trained === "proficient" ? 1 : 0;
  return abilityModifier + proficiency * multiplier;
}

function skillAbility(skill: string): "str" | "dex" | "int" | "wis" | "cha" {
  const normalized = skill.trim().toLowerCase();
  if (/athlet|athletics/.test(normalized)) return "str";
  if (/acrobat|sleight|stealth|heimlichkeit|fingerfert/.test(normalized))
    return "dex";
  if (
    /arcana|history|investigation|nature|religion|geschichte|nachforsch|natur|arkana/.test(
      normalized,
    )
  )
    return "int";
  if (
    /animal|insight|medicine|perception|survival|tier|motiv|medizin|wahrnehm|überleben/.test(
      normalized,
    )
  )
    return "wis";
  return "cha";
}

function signedModifier(value: number) {
  return value === 0 ? "" : value > 0 ? `+${value}` : String(value);
}

function partyViewFor(state: PartyRuntimeState, access: Access) {
  const actorId = playerCharacterId(access);
  const activeDialogue = Object.values(state.dialogues).find(
    (decision) =>
      decision.status === "open" &&
      (!actorId || decision.participantIds.includes(actorId)),
  );
  const activeRest = state.activeRestId
    ? state.restProposals[state.activeRestId]
    : null;
  return {
    version: state.version,
    revision: state.revision,
    members: Object.values(state.members),
    inventory: Object.values(state.inventory).filter(
      (item) =>
        access.role === "host" ||
        item.holderId === "party" ||
        item.holderId === actorId,
    ),
    equipment:
      access.role === "host"
        ? state.equipment
        : actorId
          ? { [actorId]: state.equipment[actorId] ?? {} }
          : {},
    resources:
      access.role === "host"
        ? state.resources
        : actorId
          ? { [actorId]: state.resources[actorId] ?? {} }
          : {},
    rest: activeRest,
    quests: Object.values(state.quests),
    flags: access.role === "host" ? state.flags : undefined,
    reputation: state.reputation,
    dialogue:
      activeDialogue && actorId
        ? dialogueViewFor(state, activeDialogue.id, actorId)
        : (activeDialogue ?? null),
  };
}

function encounterViewFor(
  runtime: ReturnType<typeof normalizeEncounterRuntime>,
  access: Access,
) {
  const actorId = playerCharacterId(access);
  return {
    ...runtime,
    reaction:
      access.role === "host" || runtime.reaction?.reactorTokenId === actorId
        ? runtime.reaction
        : null,
    visibility:
      access.role === "host"
        ? runtime.visibility
        : actorId
          ? { [actorId]: runtime.visibility[actorId] ?? {} }
          : {},
  };
}

export async function publishPartyEvent(
  sessionId: string,
  event: PartyDomainEvent,
  state: PartyRuntimeState,
  access: Access,
) {
  const mapped = clientPartyEvent(event, state);
  if (!mapped) return;
  await publishEvent(sessionId, mapped.type, mapped.payload, {
    actorId: access.userId,
    scope: mapped.scope,
  });
}

function clientPartyEvent(
  event: PartyDomainEvent,
  state: PartyRuntimeState,
): {
  type: string;
  payload: Record<string, unknown>;
  scope: GameEventScope;
} | null {
  const base = { ...event.payload, revision: event.revision };
  if (event.type.startsWith("inventory_")) {
    const memberId =
      cleanString(event.payload.memberId) ??
      cleanString(event.payload.holderId);
    return {
      type:
        event.type === "inventory_equipped" ||
        event.type === "inventory_unequipped"
          ? "equipment_changed"
          : "inventory_changed",
      payload: { ...base, message: "Inventar aktualisiert" },
      scope:
        memberId && state.members[memberId] ? `character:${memberId}` : "all",
    };
  }
  if (event.type === "resource_spent" || event.type === "resource_restored") {
    const memberId = cleanString(event.payload.memberId);
    return {
      type: event.type,
      payload: base,
      scope: memberId ? `character:${memberId}` : "all",
    };
  }
  if (event.type.startsWith("rest_")) {
    const proposalId =
      cleanString(event.payload.proposalId) ?? state.activeRestId;
    const proposal = proposalId ? state.restProposals[proposalId] : null;
    const type =
      event.type === "rest_completed"
        ? "rest_completed"
        : event.type === "rest_proposed"
          ? "rest_proposed"
          : "rest_vote_cast";
    return {
      type,
      payload: {
        ...base,
        id: proposal?.id ?? proposalId,
        kind: proposal?.type ?? event.payload.restType,
        votes: proposal?.votes ?? {},
        required: proposal?.eligibleMemberIds.length ?? 1,
        status: proposal?.status,
      },
      scope: "all",
    };
  }
  if (event.type.startsWith("quest_")) {
    const questId = cleanString(event.payload.questId);
    const quest = questId ? state.quests[questId] : undefined;
    if (!quest) return null;
    return {
      type: "quest_updated",
      payload: {
        revision: event.revision,
        id: quest.id,
        title: quest.title,
        status: quest.status,
        objectives: Object.values(quest.objectives).map((objective) => ({
          id: objective.id,
          label: objective.title,
          status: objective.status,
          progress: objective.progress,
          target: objective.target,
        })),
      },
      scope: "all",
    };
  }
  if (event.type === "flag_set") {
    return { type: "decision_recorded", payload: base, scope: "all" };
  }
  if (event.type === "reputation_changed") {
    return { type: "reputation_changed", payload: base, scope: "all" };
  }
  if (event.type.startsWith("dialogue_")) {
    const decisionId = cleanString(event.payload.decisionId);
    const decision = decisionId ? state.dialogues[decisionId] : undefined;
    if (!decision) return null;
    const type =
      event.type === "dialogue_opened"
        ? "dialogue_opened"
        : event.type === "dialogue_resolved" ||
            event.type === "dialogue_cancelled"
          ? "dialogue_resolved"
          : "dialogue_vote_cast";
    return {
      type,
      payload: {
        ...base,
        id: decision.id,
        prompt: decision.prompt,
        options: decision.optionOrder.map((id) => ({
          id,
          label: decision.options[id].label,
        })),
        votes: Object.fromEntries(
          Object.entries(decision.votes).map(([memberId, vote]) => [
            memberId,
            vote.secret ? "hidden" : vote.optionId,
          ]),
        ),
      },
      scope: "all",
    };
  }
  return null;
}

function playerCharacterId(access: Access) {
  return access.role === "player" ? access.characterId : null;
}

function partyRuleStatus(code: string) {
  if (code.includes("not_found")) return 404;
  if (code.includes("forbidden") || code.includes("required")) return 403;
  if (
    code.includes("conflict") ||
    code.includes("active") ||
    code.includes("closed")
  )
    return 409;
  return 422;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function inferEquipmentSlots(name: string) {
  if (/schild/i.test(name)) return ["off-hand"];
  if (/rüstung|armor|robe/i.test(name)) return ["armor"];
  if (/ring/i.test(name)) return ["ring-1", "ring-2"];
  if (/helm|hut|kapuze/i.test(name)) return ["head"];
  if (/schwert|axt|bogen|dolch|stab|weapon/i.test(name)) return ["main-hand"];
  return [];
}
