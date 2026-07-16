import {
  PARTY_STATE_VERSION,
  type DialogueCheck,
  type DialogueDecision,
  type DialogueOption,
  type DialogueResolution,
  type DialogueView,
  type InventoryHolderId,
  type InventoryItemGrant,
  type InventoryItemInstance,
  type ObjectiveStatus,
  type PartyCommand,
  type PartyDomainEvent,
  type PartyEffect,
  type PartyFlagValue,
  type PartyMember,
  type PartyReducerResult,
  type PartyResource,
  type PartyRuntimeState,
  type QuestObjective,
  type QuestStatus,
  type RestProposal,
  type StructuredQuest,
} from "./party-types";

export * from "./party-types";

type PendingEvent = Omit<PartyDomainEvent, "revision">;

class RuleViolation extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuleViolation";
  }
}

export class UnsupportedPartyStateVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `Party state version ${version} is newer than supported version ${PARTY_STATE_VERSION}`,
    );
    this.name = "UnsupportedPartyStateVersionError";
  }
}

export function createPartyState(
  members: Array<Pick<PartyMember, "id" | "name"> & Partial<PartyMember>> = [],
): PartyRuntimeState {
  const memberRecord: Record<string, PartyMember> = {};
  const equipment: PartyRuntimeState["equipment"] = {};
  const resources: PartyRuntimeState["resources"] = {};

  for (const input of members) {
    const id = cleanString(input.id);
    if (!id || memberRecord[id]) continue;
    memberRecord[id] = {
      id,
      name: cleanString(input.name) ?? id,
      active: input.active !== false,
    };
    equipment[id] = {};
    resources[id] = {};
  }

  return {
    version: PARTY_STATE_VERSION,
    revision: 0,
    members: memberRecord,
    inventory: {},
    equipment,
    resources,
    restProposals: {},
    activeRestId: null,
    quests: {},
    flags: {},
    reputation: {},
    dialogues: {},
    processedCommands: {},
  };
}

/**
 * Converts persisted JSON from legacy or partially-valid runtime snapshots into
 * the current, JSON-safe shape. Unknown future versions fail loudly so a newer
 * save can never be destructively downgraded.
 */
export function normalizePartyState(raw: unknown): PartyRuntimeState {
  const input = asRecord(raw);
  const version = integer(input.version) ?? 1;
  if (version > PARTY_STATE_VERSION) {
    throw new UnsupportedPartyStateVersionError(version);
  }

  const state = createPartyState(normalizeMembers(input.members));
  state.revision = nonNegativeInteger(input.revision) ?? 0;

  const inventorySource = Array.isArray(input.inventory)
    ? input.inventory
    : (asRecord(input.inventory).items ?? input.inventory);
  for (const entry of recordOrArrayValues(inventorySource)) {
    const item = normalizeItem(entry, state.members);
    if (item && !state.inventory[item.instanceId]) {
      state.inventory[item.instanceId] = item;
    }
  }

  normalizeEquipment(input.equipment, state);
  normalizeResources(input.resources ?? input.resourcePools, state);
  normalizeRests(input.restProposals ?? input.rests, state);
  normalizeQuests(input.quests, state);
  normalizeFlags(input.flags ?? input.questFlags, state.flags);
  normalizeReputation(input.reputation ?? input.reputations, state.reputation);
  normalizeDialogues(input.dialogues, state);
  normalizeProcessedCommands(input.processedCommands, state.processedCommands);

  const requestedActiveRestId = cleanString(input.activeRestId);
  if (
    requestedActiveRestId &&
    state.restProposals[requestedActiveRestId]?.status === "proposed"
  ) {
    state.activeRestId = requestedActiveRestId;
  } else {
    state.activeRestId =
      Object.values(state.restProposals).find(
        (proposal) =>
          proposal.status === "proposed" || proposal.status === "accepted",
      )?.id ?? null;
  }

  return state;
}

export const migratePartyState = normalizePartyState;

export function reducePartyState(
  rawState: unknown,
  command: PartyCommand,
): PartyReducerResult {
  const state = normalizePartyState(rawState);
  const commandId = cleanString(command.commandId);
  if (!commandId) {
    return failed(
      state,
      "invalid_command_id",
      "A non-empty commandId is required",
    );
  }
  if (state.processedCommands[commandId] !== undefined) {
    return { ok: true, state, events: [], duplicate: true };
  }

  const next = structuredClone(state);
  const events: PendingEvent[] = [];

  try {
    const duplicate = applyCommand(next, command, events);
    if (duplicate) return { ok: true, state, events: [], duplicate: true };

    next.revision = state.revision + 1;
    next.processedCommands[commandId] = next.revision;
    return {
      ok: true,
      state: next,
      events: events.map((event) => ({ ...event, revision: next.revision })),
      duplicate: false,
    };
  } catch (error) {
    if (error instanceof RuleViolation) {
      return failed(state, error.code, error.message, error.details);
    }
    throw error;
  }
}

export const reduceParty = reducePartyState;

export function dialogueOptionEligibility(
  rawState: unknown,
  decisionId: string,
  optionId: string,
  memberId: string,
): { eligible: boolean; reasons: string[] } {
  const state = normalizePartyState(rawState);
  const decision = state.dialogues[decisionId];
  const option = decision?.options[optionId];
  const reasons: string[] = [];

  if (!decision) reasons.push("dialogue_not_found");
  if (decision && !decision.participantIds.includes(memberId)) {
    reasons.push("not_a_participant");
  }
  if (!state.members[memberId]?.active) reasons.push("member_inactive");
  if (!option) reasons.push("option_not_found");
  if (option) reasons.push(...eligibilityReasons(state, option, memberId));

  return { eligible: reasons.length === 0, reasons };
}

export function dialogueViewFor(
  rawState: unknown,
  decisionId: string,
  viewerId: string,
): DialogueView | null {
  const state = normalizePartyState(rawState);
  const decision = state.dialogues[decisionId];
  if (!decision) return null;

  const view = structuredClone(decision) as DialogueView;
  view.votes = Object.fromEntries(
    Object.entries(decision.votes).map(([memberId, vote]) => [
      memberId,
      {
        optionId: vote.secret && memberId !== viewerId ? null : vote.optionId,
        secret: vote.secret,
      },
    ]),
  );
  return view;
}

function applyCommand(
  state: PartyRuntimeState,
  command: PartyCommand,
  events: PendingEvent[],
): boolean {
  switch (command.type) {
    case "inventory.loot":
      lootItems(state, command.holderId, command.items, events);
      return false;
    case "inventory.transfer":
      transferItem(state, command, events);
      return false;
    case "inventory.equip":
      equipItem(state, command.memberId, command.itemId, command.slot, events);
      return false;
    case "inventory.unequip":
      unequipItem(state, command.memberId, command.slot, events);
      return false;
    case "inventory.use":
      consumeItem(
        state,
        command.memberId,
        command.itemId,
        command.quantity ?? 1,
        events,
      );
      return false;
    case "resource.define":
      defineResource(state, command.memberId, command.resource, events);
      return false;
    case "resource.spend":
      changeResource(
        state,
        command.memberId,
        command.resourceId,
        -(command.amount ?? 1),
        "resource_spent",
        events,
      );
      return false;
    case "resource.restore":
      changeResource(
        state,
        command.memberId,
        command.resourceId,
        command.amount ?? 1,
        "resource_restored",
        events,
      );
      return false;
    case "rest.propose":
      proposeRest(state, command, events);
      return false;
    case "rest.vote":
      voteOnRest(
        state,
        command.proposalId,
        command.memberId,
        command.approve,
        events,
      );
      return false;
    case "rest.complete":
      completeRest(state, command.proposalId, events);
      return false;
    case "rest.cancel":
      cancelRest(state, command.proposalId, command.memberId, events);
      return false;
    case "quest.upsert":
      upsertQuest(state, command.quest, events);
      return false;
    case "quest.setStatus":
      setQuestStatus(state, command.questId, command.status, events);
      return false;
    case "quest.setObjective":
      setQuestObjective(
        state,
        command.questId,
        command.objectiveId,
        command.status,
        command.progress,
        events,
      );
      return false;
    case "flag.set":
      setFlag(state, command.key, command.value, events);
      return false;
    case "reputation.adjust":
      adjustReputation(state, command.factionId, command.amount, events);
      return false;
    case "dialogue.open":
      openDialogue(state, command.decision, events);
      return false;
    case "dialogue.setSpeaker":
      setDialogueSpeaker(state, command.decisionId, command.speakerId, events);
      return false;
    case "dialogue.vote":
      voteInDialogue(
        state,
        command.decisionId,
        command.memberId,
        command.optionId,
        command.secret ?? true,
        events,
      );
      return false;
    case "dialogue.delegateCheck":
      delegateDialogueCheck(
        state,
        command.decisionId,
        command.optionId,
        command.delegatorId,
        command.memberId,
        events,
      );
      return false;
    case "dialogue.assist":
      assistDialogueCheck(
        state,
        command.decisionId,
        command.optionId,
        command.memberId,
        command.enabled,
        events,
      );
      return false;
    case "dialogue.resolve":
      return resolveDialogue(
        state,
        command.decisionId,
        command.memberId,
        command.optionId,
        command.checkOutcome,
        events,
      );
    case "dialogue.cancel":
      cancelDialogue(state, command.decisionId, command.memberId, events);
      return false;
  }
}

function lootItems(
  state: PartyRuntimeState,
  holderId: InventoryHolderId,
  grants: InventoryItemGrant[],
  events: PendingEvent[],
): void {
  requireHolder(state, holderId);
  requireRule(
    grants.length > 0,
    "empty_loot",
    "Loot must contain at least one item",
  );

  for (const rawGrant of grants) {
    const grant = validateGrant(rawGrant);
    let remaining = grant.quantity;
    const mergedInto: string[] = [];

    for (const target of compatibleStacks(state, grant, holderId)) {
      if (remaining === 0) break;
      const moved = Math.min(remaining, target.maxStack - target.quantity);
      if (moved <= 0) continue;
      target.quantity += moved;
      remaining -= moved;
      mergedInto.push(target.instanceId);
    }

    let index = 0;
    const created: string[] = [];
    while (remaining > 0) {
      const instanceId =
        index === 0 ? grant.instanceId : `${grant.instanceId}:${index}`;
      requireRule(
        !state.inventory[instanceId],
        "item_id_conflict",
        `Inventory item ${instanceId} already exists`,
        { instanceId },
      );
      const quantity = Math.min(remaining, grant.maxStack);
      state.inventory[instanceId] = {
        ...grant,
        instanceId,
        holderId,
        quantity,
        equippableSlots: [...grant.equippableSlots],
      };
      created.push(instanceId);
      remaining -= quantity;
      index += 1;
    }

    events.push({
      type: "inventory_looted",
      payload: {
        holderId,
        definitionId: grant.definitionId,
        quantity: grant.quantity,
        created,
        mergedInto,
      },
    });
  }
}

function transferItem(
  state: PartyRuntimeState,
  command: Extract<PartyCommand, { type: "inventory.transfer" }>,
  events: PendingEvent[],
): void {
  requireHolder(state, command.toHolderId);
  const source = requireItem(state, command.itemId);
  const fromHolderId = source.holderId;
  requireRule(
    !source.equipped,
    "item_equipped",
    "Equipped items must be unequipped before transfer",
  );
  requireRule(
    source.holderId !== command.toHolderId,
    "same_holder",
    "Item already belongs to that holder",
  );
  const quantity = command.quantity ?? source.quantity;
  requirePositiveInteger(quantity, "invalid_quantity");
  requireRule(
    quantity <= source.quantity,
    "invalid_quantity",
    "Transfer exceeds item quantity",
  );

  let remaining = quantity;
  const mergedInto: string[] = [];
  for (const target of compatibleStacks(state, source, command.toHolderId)) {
    if (remaining === 0) break;
    const moved = Math.min(remaining, target.maxStack - target.quantity);
    if (moved <= 0) continue;
    target.quantity += moved;
    remaining -= moved;
    mergedInto.push(target.instanceId);
  }

  let createdItemId: string | null = null;
  if (quantity === source.quantity) {
    if (remaining === 0) {
      delete state.inventory[source.instanceId];
    } else {
      source.quantity = remaining;
      source.holderId = command.toHolderId;
      createdItemId = source.instanceId;
    }
  } else {
    source.quantity -= quantity;
    if (remaining > 0) {
      const newInstanceId = cleanString(command.newInstanceId);
      requireRule(
        Boolean(newInstanceId),
        "new_item_id_required",
        "A partial transfer that creates a stack requires newInstanceId",
      );
      requireRule(
        !state.inventory[newInstanceId!],
        "item_id_conflict",
        `Inventory item ${newInstanceId} already exists`,
      );
      state.inventory[newInstanceId!] = {
        ...structuredClone(source),
        instanceId: newInstanceId!,
        holderId: command.toHolderId,
        quantity: remaining,
      };
      createdItemId = newInstanceId!;
    }
  }

  events.push({
    type: "inventory_transferred",
    payload: {
      itemId: source.instanceId,
      fromHolderId,
      toHolderId: command.toHolderId,
      quantity,
      createdItemId,
      mergedInto,
    },
  });
}

function equipItem(
  state: PartyRuntimeState,
  memberId: string,
  itemId: string,
  slot: string,
  events: PendingEvent[],
): void {
  requireMember(state, memberId);
  const item = requireItem(state, itemId);
  const cleanSlot = cleanString(slot);
  requireRule(Boolean(cleanSlot), "invalid_slot", "Equipment slot is required");
  requireRule(
    item.holderId === memberId,
    "wrong_holder",
    "Member does not hold this item",
  );
  requireRule(
    item.quantity === 1,
    "stack_not_equippable",
    "A stacked item cannot be equipped",
  );
  requireRule(
    item.equippableSlots.includes(cleanSlot!),
    "slot_not_allowed",
    `${item.name} cannot be equipped in ${cleanSlot}`,
  );

  if (
    item.equipped?.slot === cleanSlot &&
    item.equipped.memberId === memberId
  ) {
    throw new RuleViolation(
      "already_equipped",
      "Item is already equipped in that slot",
    );
  }
  if (item.equipped) {
    delete state.equipment[item.equipped.memberId]?.[item.equipped.slot];
  }

  const replacedId = state.equipment[memberId]?.[cleanSlot!];
  if (replacedId && replacedId !== itemId) {
    const replaced = state.inventory[replacedId];
    if (replaced) delete replaced.equipped;
    events.push({
      type: "inventory_unequipped",
      payload: {
        memberId,
        itemId: replacedId,
        slot: cleanSlot,
        replaced: true,
      },
    });
  }

  state.equipment[memberId] ??= {};
  state.equipment[memberId][cleanSlot!] = itemId;
  item.equipped = { memberId, slot: cleanSlot! };
  events.push({
    type: "inventory_equipped",
    payload: {
      memberId,
      itemId,
      slot: cleanSlot,
      replacedItemId: replacedId ?? null,
    },
  });
}

function unequipItem(
  state: PartyRuntimeState,
  memberId: string,
  slot: string,
  events: PendingEvent[],
): void {
  requireMember(state, memberId);
  const itemId = state.equipment[memberId]?.[slot];
  requireRule(Boolean(itemId), "slot_empty", `Nothing is equipped in ${slot}`);
  delete state.equipment[memberId][slot];
  const item = state.inventory[itemId!];
  if (item) delete item.equipped;
  events.push({
    type: "inventory_unequipped",
    payload: { memberId, itemId, slot },
  });
}

function consumeItem(
  state: PartyRuntimeState,
  memberId: string,
  itemId: string,
  quantity: number,
  events: PendingEvent[],
): void {
  requireMember(state, memberId);
  const item = requireItem(state, itemId);
  requirePositiveInteger(quantity, "invalid_quantity");
  requireRule(
    item.holderId === memberId || item.holderId === "party",
    "wrong_holder",
    "Item is unavailable to this member",
  );
  requireRule(item.usable, "item_not_usable", `${item.name} is not usable`);
  requireRule(
    !item.equipped,
    "item_equipped",
    "Equipped item cannot be consumed",
  );
  requireRule(
    quantity <= item.quantity,
    "invalid_quantity",
    "Use exceeds item quantity",
  );

  if (item.useEffect?.type === "restore_resource") {
    const total = item.useEffect.amount * quantity;
    changeResource(
      state,
      memberId,
      item.useEffect.resourceId,
      total,
      "resource_restored",
      events,
    );
  }

  item.quantity -= quantity;
  if (item.quantity === 0) delete state.inventory[itemId];
  events.push({
    type: "inventory_used",
    payload: { memberId, itemId, definitionId: item.definitionId, quantity },
  });
}

function defineResource(
  state: PartyRuntimeState,
  memberId: string,
  raw: PartyResource,
  events: PendingEvent[],
): void {
  requireMember(state, memberId);
  const resource = validateResource(raw);
  state.resources[memberId] ??= {};
  state.resources[memberId][resource.id] = resource;
  events.push({
    type: "resource_defined",
    payload: {
      memberId,
      resourceId: resource.id,
      kind: resource.kind,
      level: resource.level ?? null,
    },
  });
}

function changeResource(
  state: PartyRuntimeState,
  memberId: string,
  resourceId: string,
  delta: number,
  eventType: "resource_spent" | "resource_restored",
  events: PendingEvent[],
): void {
  requireMember(state, memberId);
  requirePositiveInteger(Math.abs(delta), "invalid_amount");
  const resource = state.resources[memberId]?.[resourceId];
  requireRule(
    Boolean(resource),
    "resource_not_found",
    `Resource ${resourceId} was not found`,
  );
  const before = resource!.current;
  const after = Math.min(resource!.max, before + delta);
  requireRule(
    after >= 0,
    "insufficient_resource",
    `Not enough ${resource!.label}`,
  );
  resource!.current = after;
  events.push({
    type: eventType,
    payload: {
      memberId,
      resourceId,
      amount: Math.abs(after - before),
      current: after,
      max: resource!.max,
    },
  });
}

function proposeRest(
  state: PartyRuntimeState,
  command: Extract<PartyCommand, { type: "rest.propose" }>,
  events: PendingEvent[],
): void {
  requireMember(state, command.proposerId);
  requireRule(
    !state.activeRestId,
    "rest_already_active",
    "Another rest vote is active",
  );
  requireRule(
    !state.restProposals[command.proposalId],
    "rest_id_conflict",
    "Rest proposal already exists",
  );
  const eligible = uniqueStrings(
    command.eligibleMemberIds ??
      Object.values(state.members)
        .filter((member) => member.active)
        .map((member) => member.id),
  );
  requireRule(
    eligible.length > 0,
    "rest_has_no_voters",
    "Rest requires at least one voter",
  );
  for (const memberId of eligible) requireMember(state, memberId);
  requireRule(
    eligible.includes(command.proposerId),
    "proposer_not_eligible",
    "Proposer must be eligible to vote",
  );

  const proposal: RestProposal = {
    id: command.proposalId,
    type: command.restType,
    proposerId: command.proposerId,
    eligibleMemberIds: eligible,
    policy: command.policy ?? "unanimous",
    votes: { [command.proposerId]: true },
    status: "proposed",
  };
  evaluateRestVote(proposal);
  state.restProposals[proposal.id] = proposal;
  state.activeRestId =
    proposal.status === "accepted" ? proposal.id : proposal.id;
  events.push({
    type: "rest_proposed",
    payload: {
      proposalId: proposal.id,
      restType: proposal.type,
      proposerId: proposal.proposerId,
      policy: proposal.policy,
      eligibleMemberIds: proposal.eligibleMemberIds,
    },
  });
  if (proposal.status === "accepted") {
    events.push({
      type: "rest_accepted",
      payload: { proposalId: proposal.id },
    });
  }
}

function voteOnRest(
  state: PartyRuntimeState,
  proposalId: string,
  memberId: string,
  approve: boolean,
  events: PendingEvent[],
): void {
  const proposal = requireRest(state, proposalId);
  requireRule(
    proposal.status === "proposed",
    "rest_vote_closed",
    "Rest vote is closed",
  );
  requireRule(
    proposal.eligibleMemberIds.includes(memberId),
    "voter_not_eligible",
    "Member cannot vote on this rest",
  );
  proposal.votes[memberId] = approve;
  const previousStatus = proposal.status;
  evaluateRestVote(proposal);
  events.push({
    type: "rest_vote_cast",
    payload: { proposalId, memberId, approve },
  });
  if (proposal.status !== previousStatus) {
    events.push({
      type: proposal.status === "accepted" ? "rest_accepted" : "rest_rejected",
      payload: { proposalId },
    });
    if (proposal.status === "rejected") state.activeRestId = null;
  }
}

function completeRest(
  state: PartyRuntimeState,
  proposalId: string,
  events: PendingEvent[],
): void {
  const proposal = requireRest(state, proposalId);
  requireRule(
    proposal.status === "accepted",
    "rest_not_accepted",
    "Rest vote has not been accepted",
  );
  const restored: Array<{
    memberId: string;
    resourceId: string;
    amount: number;
  }> = [];
  for (const memberId of proposal.eligibleMemberIds) {
    for (const resource of Object.values(state.resources[memberId] ?? {})) {
      const resets =
        proposal.type === "long"
          ? resource.resetOn === "short" || resource.resetOn === "long"
          : resource.resetOn === "short";
      if (!resets || resource.current === resource.max) continue;
      restored.push({
        memberId,
        resourceId: resource.id,
        amount: resource.max - resource.current,
      });
      resource.current = resource.max;
    }
  }
  proposal.status = "completed";
  proposal.completedRevision = state.revision + 1;
  state.activeRestId = null;
  events.push({
    type: "rest_completed",
    payload: { proposalId, restType: proposal.type, restored },
  });
}

function cancelRest(
  state: PartyRuntimeState,
  proposalId: string,
  memberId: string,
  events: PendingEvent[],
): void {
  const proposal = requireRest(state, proposalId);
  requireRule(
    proposal.proposerId === memberId,
    "not_rest_proposer",
    "Only the proposer can cancel the rest",
  );
  requireRule(
    proposal.status === "proposed" || proposal.status === "accepted",
    "rest_vote_closed",
    "Rest can no longer be cancelled",
  );
  proposal.status = "cancelled";
  state.activeRestId = null;
  events.push({ type: "rest_cancelled", payload: { proposalId, memberId } });
}

function upsertQuest(
  state: PartyRuntimeState,
  rawQuest: StructuredQuest,
  events: PendingEvent[],
): void {
  const quest = validateQuest(rawQuest);
  const created = !state.quests[quest.id];
  state.quests[quest.id] = quest;
  events.push({
    type: "quest_upserted",
    payload: { questId: quest.id, created, status: quest.status },
  });
}

function setQuestStatus(
  state: PartyRuntimeState,
  questId: string,
  status: QuestStatus,
  events: PendingEvent[],
): void {
  const quest = requireQuest(state, questId);
  requireQuestStatus(status);
  quest.status = status;
  events.push({ type: "quest_status_changed", payload: { questId, status } });
}

function setQuestObjective(
  state: PartyRuntimeState,
  questId: string,
  objectiveId: string,
  status: ObjectiveStatus | undefined,
  progress: number | undefined,
  events: PendingEvent[],
): void {
  const quest = requireQuest(state, questId);
  const objective = quest.objectives[objectiveId];
  requireRule(
    Boolean(objective),
    "objective_not_found",
    `Objective ${objectiveId} was not found`,
  );
  requireRule(
    status !== undefined || progress !== undefined,
    "empty_objective_update",
    "Objective update is empty",
  );
  if (status !== undefined) {
    requireObjectiveStatus(status);
    objective!.status = status;
  }
  if (progress !== undefined) {
    requireRule(
      Number.isInteger(progress) && progress >= 0,
      "invalid_progress",
      "Objective progress must be a non-negative integer",
    );
    objective!.progress = Math.min(progress, objective!.target);
    if (
      objective!.progress >= objective!.target &&
      objective!.status !== "failed"
    ) {
      objective!.status = "completed";
    }
  }
  events.push({
    type: "quest_objective_changed",
    payload: {
      questId,
      objectiveId,
      status: objective!.status,
      progress: objective!.progress,
      target: objective!.target,
    },
  });

  const required = Object.values(quest.objectives).filter(
    (item) => !item.optional,
  );
  if (
    required.length > 0 &&
    required.every((item) => item.status === "completed") &&
    quest.status !== "completed"
  ) {
    quest.status = "completed";
    events.push({
      type: "quest_status_changed",
      payload: { questId, status: "completed", automatic: true },
    });
  }
}

function setFlag(
  state: PartyRuntimeState,
  key: string,
  value: PartyFlagValue,
  events: PendingEvent[],
): void {
  const cleanKey = cleanString(key);
  requireRule(Boolean(cleanKey), "invalid_flag", "Flag key is required");
  requireRule(
    isFlagValue(value),
    "invalid_flag_value",
    "Flag value is not JSON-safe",
  );
  state.flags[cleanKey!] = value;
  events.push({ type: "flag_set", payload: { key: cleanKey, value } });
}

function adjustReputation(
  state: PartyRuntimeState,
  factionId: string,
  amount: number,
  events: PendingEvent[],
): void {
  const cleanFactionId = cleanString(factionId);
  requireRule(
    Boolean(cleanFactionId),
    "invalid_faction",
    "Faction id is required",
  );
  requireRule(
    Number.isInteger(amount) && amount !== 0,
    "invalid_amount",
    "Reputation adjustment must be a non-zero integer",
  );
  const previous = state.reputation[cleanFactionId!] ?? 0;
  state.reputation[cleanFactionId!] = previous + amount;
  events.push({
    type: "reputation_changed",
    payload: { factionId: cleanFactionId, amount, value: previous + amount },
  });
}

function openDialogue(
  state: PartyRuntimeState,
  input: Extract<PartyCommand, { type: "dialogue.open" }>["decision"],
  events: PendingEvent[],
): void {
  const id = cleanString(input.id);
  const prompt = cleanString(input.prompt);
  requireRule(
    Boolean(id && prompt),
    "invalid_dialogue",
    "Dialogue id and prompt are required",
  );
  requireRule(
    !state.dialogues[id!],
    "dialogue_id_conflict",
    "Dialogue decision already exists",
  );
  const participants = uniqueStrings(input.participantIds);
  requireRule(
    participants.length > 0,
    "dialogue_has_no_participants",
    "Dialogue needs participants",
  );
  for (const memberId of participants) requireMember(state, memberId);
  requireRule(
    participants.includes(input.speakerId),
    "invalid_speaker",
    "Speaker must be a participant",
  );
  requireRule(
    input.options.length > 0,
    "dialogue_has_no_options",
    "Dialogue needs at least one option",
  );

  const options: Record<string, DialogueOption> = {};
  const optionOrder: string[] = [];
  for (const rawOption of input.options) {
    const option = validateDialogueOption(rawOption, participants);
    requireRule(
      !options[option.id],
      "option_id_conflict",
      `Dialogue option ${option.id} is duplicated`,
    );
    options[option.id] = option;
    optionOrder.push(option.id);
  }
  state.dialogues[id!] = {
    id: id!,
    prompt: prompt!,
    participantIds: participants,
    speakerId: input.speakerId,
    resolutionMode: input.resolutionMode,
    optionOrder,
    options,
    votes: {},
    checkAssignments: {},
    status: "open",
  };
  events.push({
    type: "dialogue_opened",
    payload: {
      decisionId: id,
      participantIds: participants,
      speakerId: input.speakerId,
      optionIds: optionOrder,
    },
  });
}

function setDialogueSpeaker(
  state: PartyRuntimeState,
  decisionId: string,
  speakerId: string,
  events: PendingEvent[],
): void {
  const decision = requireOpenDialogue(state, decisionId);
  requireRule(
    decision.participantIds.includes(speakerId),
    "invalid_speaker",
    "Speaker must be a participant",
  );
  requireMember(state, speakerId);
  decision.speakerId = speakerId;
  events.push({
    type: "dialogue_speaker_changed",
    payload: { decisionId, speakerId },
  });
}

function voteInDialogue(
  state: PartyRuntimeState,
  decisionId: string,
  memberId: string,
  optionId: string,
  secret: boolean,
  events: PendingEvent[],
): void {
  const decision = requireOpenDialogue(state, decisionId);
  const option = requireDialogueOption(decision, optionId);
  requireRule(
    decision.participantIds.includes(memberId),
    "not_a_participant",
    "Member is not in this dialogue",
  );
  requireMember(state, memberId);
  const reasons = eligibilityReasons(state, option, memberId);
  requireRule(
    reasons.length === 0,
    "option_not_eligible",
    "Member is not eligible for this option",
    { reasons },
  );
  decision.votes[memberId] = { optionId, secret };
  events.push({
    type: "dialogue_vote_cast",
    payload: secret
      ? { decisionId, memberId, secret: true }
      : { decisionId, memberId, optionId, secret: false },
  });
}

function delegateDialogueCheck(
  state: PartyRuntimeState,
  decisionId: string,
  optionId: string,
  delegatorId: string,
  memberId: string,
  events: PendingEvent[],
): void {
  const decision = requireOpenDialogue(state, decisionId);
  const option = requireDialogueOption(decision, optionId);
  requireRule(
    delegatorId === decision.speakerId,
    "speaker_required",
    "Only the current speaker can delegate a check",
  );
  requireRule(
    Boolean(option.check),
    "check_not_available",
    "Option has no delegated check",
  );
  requireRule(
    decision.participantIds.includes(memberId),
    "not_a_participant",
    "Checker must be a participant",
  );
  requireMember(state, memberId);
  requireRule(
    checkerEligible(option.check!, memberId),
    "checker_not_eligible",
    "Member cannot perform this check",
  );
  decision.checkAssignments[optionId] = { memberId, assistants: [] };
  events.push({
    type: "dialogue_check_delegated",
    payload: { decisionId, optionId, delegatorId, memberId },
  });
}

function assistDialogueCheck(
  state: PartyRuntimeState,
  decisionId: string,
  optionId: string,
  memberId: string,
  enabled: boolean,
  events: PendingEvent[],
): void {
  const decision = requireOpenDialogue(state, decisionId);
  const option = requireDialogueOption(decision, optionId);
  requireRule(
    Boolean(option.check?.allowAssist),
    "assist_not_allowed",
    "This check cannot be assisted",
  );
  const assignment = decision.checkAssignments[optionId];
  requireRule(
    Boolean(assignment),
    "check_not_delegated",
    "Delegate the check before assigning assistance",
  );
  requireRule(
    decision.participantIds.includes(memberId),
    "not_a_participant",
    "Assistant must be a participant",
  );
  requireMember(state, memberId);
  requireRule(
    memberId !== assignment!.memberId,
    "checker_cannot_assist",
    "Checker cannot assist themselves",
  );

  const current = new Set(assignment!.assistants);
  if (enabled) {
    requireRule(
      current.has(memberId) || current.size < option.check!.maxAssistants,
      "assist_limit_reached",
      "No more assistants can join this check",
    );
    current.add(memberId);
  } else {
    current.delete(memberId);
  }
  assignment!.assistants = [...current].sort();
  events.push({
    type: "dialogue_assist_changed",
    payload: { decisionId, optionId, memberId, enabled },
  });
}

function resolveDialogue(
  state: PartyRuntimeState,
  decisionId: string,
  memberId: string,
  requestedOptionId: string | undefined,
  checkOutcome: DialogueResolution["checkOutcome"],
  events: PendingEvent[],
): boolean {
  const decision = state.dialogues[decisionId];
  requireRule(
    Boolean(decision),
    "dialogue_not_found",
    `Dialogue ${decisionId} was not found`,
  );
  if (decision!.status === "resolved") {
    requireRule(
      !requestedOptionId ||
        requestedOptionId === decision!.resolution?.optionId,
      "resolution_conflict",
      "Dialogue was already resolved with another option",
    );
    return true;
  }
  requireRule(
    decision!.status === "open",
    "dialogue_closed",
    "Dialogue is closed",
  );
  requireRule(
    memberId === decision!.speakerId,
    "speaker_required",
    "Only the current speaker can resolve this decision",
  );

  const voteTally = Object.fromEntries(
    decision!.optionOrder.map((id) => [id, 0]),
  );
  for (const vote of Object.values(decision!.votes)) {
    voteTally[vote.optionId] = (voteTally[vote.optionId] ?? 0) + 1;
  }

  let optionId: string | undefined;
  if (decision!.resolutionMode === "speaker") {
    optionId =
      requestedOptionId ?? decision!.votes[decision!.speakerId]?.optionId;
    requireRule(
      Boolean(optionId),
      "option_required",
      "Speaker must select an option",
    );
  } else {
    const castVotes = Object.values(voteTally).reduce(
      (sum, count) => sum + count,
      0,
    );
    requireRule(
      castVotes > 0,
      "votes_required",
      "At least one vote is required",
    );
    const highest = Math.max(...Object.values(voteTally));
    const tied = decision!.optionOrder.filter(
      (id) => voteTally[id] === highest,
    );
    const speakerVote = decision!.votes[decision!.speakerId]?.optionId;
    optionId =
      speakerVote && tied.includes(speakerVote) ? speakerVote : tied[0];
    requireRule(
      !requestedOptionId || requestedOptionId === optionId,
      "resolution_conflict",
      "Requested option does not match the majority result",
      { majorityOptionId: optionId },
    );
  }

  const option = requireDialogueOption(decision!, optionId!);
  const reasons = eligibilityReasons(state, option, decision!.speakerId);
  requireRule(
    reasons.length === 0,
    "option_not_eligible",
    "Speaker is not eligible for the resolved option",
    { reasons },
  );

  let checkerId: string | undefined;
  let assistants: string[] = [];
  if (option.check) {
    const assignment = decision!.checkAssignments[option.id];
    checkerId = assignment?.memberId ?? decision!.speakerId;
    requireRule(
      checkerEligible(option.check, checkerId),
      "checker_not_eligible",
      "No eligible checker was assigned",
    );
    requireRule(
      Boolean(checkOutcome),
      "check_outcome_required",
      "Checked options require a check outcome",
    );
    assistants = assignment?.assistants ?? [];
  } else {
    requireRule(
      !checkOutcome,
      "unexpected_check_outcome",
      "This option does not require a check",
    );
  }

  const effectsApplied =
    !option.check ||
    checkOutcome === "success" ||
    checkOutcome === "critical_success";
  if (effectsApplied) {
    for (const effect of option.effects) applyEffect(state, effect, events);
  }
  decision!.status = "resolved";
  decision!.resolution = {
    optionId: option.id,
    speakerId: decision!.speakerId,
    voteTally,
    checkerId,
    assistants: [...assistants],
    checkOutcome,
  };
  events.push({
    type: "dialogue_resolved",
    payload: {
      decisionId,
      optionId: option.id,
      speakerId: decision!.speakerId,
      voteTally,
      checkerId: checkerId ?? null,
      assistants,
      checkOutcome: checkOutcome ?? null,
      effectsApplied,
    },
  });
  return false;
}

function cancelDialogue(
  state: PartyRuntimeState,
  decisionId: string,
  memberId: string,
  events: PendingEvent[],
): void {
  const decision = requireOpenDialogue(state, decisionId);
  requireRule(
    memberId === decision.speakerId,
    "speaker_required",
    "Only the speaker can cancel this decision",
  );
  decision.status = "cancelled";
  events.push({
    type: "dialogue_cancelled",
    payload: { decisionId, memberId },
  });
}

function applyEffect(
  state: PartyRuntimeState,
  effect: PartyEffect,
  events: PendingEvent[],
): void {
  switch (effect.type) {
    case "set_flag":
      setFlag(state, effect.key, effect.value, events);
      break;
    case "adjust_reputation":
      adjustReputation(state, effect.factionId, effect.amount, events);
      break;
    case "set_quest_status":
      setQuestStatus(state, effect.questId, effect.status, events);
      break;
    case "set_objective":
      setQuestObjective(
        state,
        effect.questId,
        effect.objectiveId,
        effect.status,
        effect.progress,
        events,
      );
      break;
  }
}

function normalizeMembers(raw: unknown): PartyMember[] {
  const result: PartyMember[] = [];
  for (const [key, value] of recordOrArrayEntries(raw)) {
    const input = asRecord(value);
    const id =
      cleanString(input.id) ??
      (typeof key === "string" ? cleanString(key) : null);
    if (!id) continue;
    result.push({
      id,
      name: cleanString(input.name) ?? id,
      active: input.active !== false,
    });
  }
  return result;
}

function normalizeItem(
  raw: unknown,
  members: PartyRuntimeState["members"],
): InventoryItemInstance | null {
  const input = asRecord(raw);
  const instanceId = cleanString(input.instanceId ?? input.id);
  const definitionId = cleanString(input.definitionId ?? input.itemId);
  if (!instanceId || !definitionId) return null;
  const holderCandidate =
    cleanString(input.holderId ?? input.ownerId) ?? "party";
  const holderId =
    holderCandidate === "party" || members[holderCandidate]
      ? holderCandidate
      : "party";
  const maxStack = positiveInteger(input.maxStack) ?? 1;
  const quantity = Math.min(positiveInteger(input.quantity) ?? 1, maxStack);
  const equippableSlots = uniqueStrings(input.equippableSlots);
  const item: InventoryItemInstance = {
    instanceId,
    definitionId,
    name: cleanString(input.name) ?? definitionId,
    holderId,
    quantity,
    maxStack,
    equippableSlots,
    usable: input.usable === true,
  };
  const stackKey = cleanString(input.stackKey);
  if (stackKey) item.stackKey = stackKey;
  const useEffect = normalizeUseEffect(input.useEffect);
  if (useEffect) item.useEffect = useEffect;
  const equipped = asRecord(input.equipped);
  const equippedMemberId = cleanString(equipped.memberId);
  const equippedSlot = cleanString(equipped.slot);
  if (
    equippedMemberId &&
    equippedSlot &&
    holderId === equippedMemberId &&
    members[equippedMemberId] &&
    equippableSlots.includes(equippedSlot) &&
    quantity === 1
  ) {
    item.equipped = { memberId: equippedMemberId, slot: equippedSlot };
  }
  return item;
}

function normalizeEquipment(raw: unknown, state: PartyRuntimeState): void {
  for (const [memberId, rawSlots] of Object.entries(asRecord(raw))) {
    if (!state.members[memberId]) continue;
    for (const [slot, rawItemId] of Object.entries(asRecord(rawSlots))) {
      const itemId = cleanString(rawItemId);
      const item = itemId ? state.inventory[itemId] : undefined;
      if (
        !item ||
        item.holderId !== memberId ||
        item.quantity !== 1 ||
        !item.equippableSlots.includes(slot)
      ) {
        continue;
      }
      state.equipment[memberId][slot] = item.instanceId;
      item.equipped = { memberId, slot };
    }
  }
  for (const item of Object.values(state.inventory)) {
    if (!item.equipped) continue;
    const current = state.equipment[item.equipped.memberId][item.equipped.slot];
    if (current && current !== item.instanceId) {
      delete item.equipped;
      continue;
    }
    state.equipment[item.equipped.memberId][item.equipped.slot] =
      item.instanceId;
  }
}

function normalizeResources(raw: unknown, state: PartyRuntimeState): void {
  for (const [memberId, rawResources] of Object.entries(asRecord(raw))) {
    if (!state.members[memberId]) continue;
    for (const value of recordOrArrayValues(rawResources)) {
      const resource = normalizeResource(value);
      if (resource) state.resources[memberId][resource.id] = resource;
    }
  }
}

function normalizeRests(raw: unknown, state: PartyRuntimeState): void {
  for (const value of recordOrArrayValues(raw)) {
    const input = asRecord(value);
    const id = cleanString(input.id);
    const proposerId = cleanString(input.proposerId);
    const type =
      input.type === "long" ? "long" : input.type === "short" ? "short" : null;
    if (!id || !proposerId || !type || !state.members[proposerId]) continue;
    const eligibleMemberIds = uniqueStrings(input.eligibleMemberIds).filter(
      (memberId) => Boolean(state.members[memberId]),
    );
    if (!eligibleMemberIds.includes(proposerId))
      eligibleMemberIds.unshift(proposerId);
    const votes: Record<string, boolean> = {};
    for (const [memberId, vote] of Object.entries(asRecord(input.votes))) {
      if (eligibleMemberIds.includes(memberId) && typeof vote === "boolean")
        votes[memberId] = vote;
    }
    const status = restStatus(input.status);
    state.restProposals[id] = {
      id,
      type,
      proposerId,
      eligibleMemberIds,
      policy: input.policy === "majority" ? "majority" : "unanimous",
      votes,
      status,
      completedRevision:
        nonNegativeInteger(input.completedRevision) ?? undefined,
    };
  }
}

function normalizeQuests(raw: unknown, state: PartyRuntimeState): void {
  for (const value of recordOrArrayValues(raw)) {
    try {
      const quest = validateQuest(value as StructuredQuest);
      state.quests[quest.id] = quest;
    } catch (error) {
      if (!(error instanceof RuleViolation)) throw error;
    }
  }
}

function normalizeFlags(
  raw: unknown,
  target: Record<string, PartyFlagValue>,
): void {
  for (const [key, value] of Object.entries(asRecord(raw))) {
    if (isFlagValue(value)) target[key] = value;
  }
}

function normalizeReputation(
  raw: unknown,
  target: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(asRecord(raw))) {
    if (typeof value === "number" && Number.isFinite(value))
      target[key] = Math.trunc(value);
  }
}

function normalizeDialogues(raw: unknown, state: PartyRuntimeState): void {
  for (const value of recordOrArrayValues(raw)) {
    const input = asRecord(value);
    const id = cleanString(input.id);
    const prompt = cleanString(input.prompt);
    const participantIds = uniqueStrings(input.participantIds).filter(
      (memberId) => Boolean(state.members[memberId]),
    );
    const speakerId = cleanString(input.speakerId);
    if (!id || !prompt || !speakerId || !participantIds.includes(speakerId))
      continue;
    const options: Record<string, DialogueOption> = {};
    const rawOptionSource = input.options;
    for (const rawOption of recordOrArrayValues(rawOptionSource)) {
      try {
        const option = validateDialogueOption(
          rawOption as DialogueOption,
          participantIds,
        );
        options[option.id] = option;
      } catch (error) {
        if (!(error instanceof RuleViolation)) throw error;
      }
    }
    const optionOrder = uniqueStrings(input.optionOrder).filter((optionId) =>
      Boolean(options[optionId]),
    );
    for (const optionId of Object.keys(options))
      if (!optionOrder.includes(optionId)) optionOrder.push(optionId);
    if (optionOrder.length === 0) continue;
    const votes: DialogueDecision["votes"] = {};
    for (const [memberId, rawVote] of Object.entries(asRecord(input.votes))) {
      const vote = asRecord(rawVote);
      const optionId = cleanString(vote.optionId);
      if (participantIds.includes(memberId) && optionId && options[optionId]) {
        votes[memberId] = { optionId, secret: vote.secret !== false };
      }
    }
    const checkAssignments: DialogueDecision["checkAssignments"] = {};
    for (const [optionId, rawAssignment] of Object.entries(
      asRecord(input.checkAssignments),
    )) {
      const assignment = asRecord(rawAssignment);
      const memberId = cleanString(assignment.memberId);
      if (
        !options[optionId]?.check ||
        !memberId ||
        !participantIds.includes(memberId)
      )
        continue;
      checkAssignments[optionId] = {
        memberId,
        assistants: uniqueStrings(assignment.assistants).filter(
          (idValue) => participantIds.includes(idValue) && idValue !== memberId,
        ),
      };
    }
    const status =
      input.status === "resolved" || input.status === "cancelled"
        ? input.status
        : "open";
    const decision: DialogueDecision = {
      id,
      prompt,
      participantIds,
      speakerId,
      resolutionMode:
        input.resolutionMode === "majority" ? "majority" : "speaker",
      optionOrder,
      options,
      votes,
      checkAssignments,
      status,
    };
    const resolution = normalizeResolution(input.resolution, decision);
    if (status === "resolved" && resolution) decision.resolution = resolution;
    else if (status === "resolved") decision.status = "open";
    state.dialogues[id] = decision;
  }
}

function normalizeProcessedCommands(
  raw: unknown,
  target: Record<string, number>,
): void {
  for (const [commandId, value] of Object.entries(asRecord(raw))) {
    const revision = nonNegativeInteger(value);
    if (commandId.trim() && revision !== null) target[commandId] = revision;
  }
}

function normalizeResolution(
  raw: unknown,
  decision: DialogueDecision,
): DialogueResolution | null {
  const input = asRecord(raw);
  const optionId = cleanString(input.optionId);
  const speakerId = cleanString(input.speakerId);
  if (!optionId || !decision.options[optionId] || !speakerId) return null;
  const voteTally: Record<string, number> = {};
  for (const option of decision.optionOrder) {
    voteTally[option] =
      nonNegativeInteger(asRecord(input.voteTally)[option]) ?? 0;
  }
  const checkerId = cleanString(input.checkerId) ?? undefined;
  const outcome = checkOutcomeValue(input.checkOutcome);
  return {
    optionId,
    speakerId,
    voteTally,
    checkerId,
    assistants: uniqueStrings(input.assistants),
    checkOutcome: outcome ?? undefined,
  };
}

function validateGrant(raw: InventoryItemGrant): InventoryItemGrant {
  const item = normalizeItem(raw, {});
  requireRule(
    Boolean(item),
    "invalid_item",
    "Loot item is missing instanceId or definitionId",
  );
  requireRule(
    item!.holderId === "party",
    "invalid_item",
    "Loot item could not be normalized",
  );
  const grant: InventoryItemGrant = {
    instanceId: item!.instanceId,
    definitionId: item!.definitionId,
    name: item!.name,
    quantity: positiveInteger(asRecord(raw).quantity) ?? item!.quantity,
    maxStack: item!.maxStack,
    equippableSlots: [...item!.equippableSlots],
    usable: item!.usable,
  };
  if (item!.stackKey) grant.stackKey = item!.stackKey;
  if (item!.useEffect) grant.useEffect = structuredClone(item!.useEffect);
  return grant;
}

function validateResource(raw: PartyResource): PartyResource {
  const resource = normalizeResource(raw);
  requireRule(
    Boolean(resource),
    "invalid_resource",
    "Resource definition is invalid",
  );
  return resource!;
}

function normalizeResource(raw: unknown): PartyResource | null {
  const input = asRecord(raw);
  const id = cleanString(input.id);
  const max = nonNegativeInteger(input.max);
  if (!id || max === null) return null;
  const current = Math.min(nonNegativeInteger(input.current) ?? max, max);
  const kind =
    input.kind === "spell_slot" ||
    input.kind === "class" ||
    input.kind === "health"
      ? input.kind
      : "other";
  const resetOn =
    input.resetOn === "short" || input.resetOn === "long"
      ? input.resetOn
      : "none";
  const level = positiveInteger(input.level) ?? undefined;
  return {
    id,
    label: cleanString(input.label) ?? id,
    kind,
    current,
    max,
    resetOn,
    level,
  };
}

function validateQuest(raw: StructuredQuest): StructuredQuest {
  const input = asRecord(raw);
  const id = cleanString(input.id);
  const title = cleanString(input.title);
  requireRule(
    Boolean(id && title),
    "invalid_quest",
    "Quest id and title are required",
  );
  const status = questStatus(input.status);
  const objectives: Record<string, QuestObjective> = {};
  for (const value of recordOrArrayValues(input.objectives)) {
    const objectiveInput = asRecord(value);
    const objectiveId = cleanString(objectiveInput.id);
    const objectiveTitle = cleanString(objectiveInput.title);
    if (!objectiveId || !objectiveTitle || objectives[objectiveId]) continue;
    const target = positiveInteger(objectiveInput.target) ?? 1;
    const progress = Math.min(
      nonNegativeInteger(objectiveInput.progress) ?? 0,
      target,
    );
    objectives[objectiveId] = {
      id: objectiveId,
      title: objectiveTitle,
      status: objectiveStatus(objectiveInput.status),
      progress,
      target,
      optional: objectiveInput.optional === true,
    };
  }
  const objectiveOrder = uniqueStrings(input.objectiveOrder).filter(
    (objectiveId) => Boolean(objectives[objectiveId]),
  );
  for (const objectiveId of Object.keys(objectives))
    if (!objectiveOrder.includes(objectiveId)) objectiveOrder.push(objectiveId);
  const quest: StructuredQuest = {
    id: id!,
    title: title!,
    status,
    objectiveOrder,
    objectives,
  };
  const description = cleanString(input.description);
  if (description) quest.description = description;
  return quest;
}

function validateDialogueOption(
  raw: DialogueOption,
  participantIds: string[],
): DialogueOption {
  const input = asRecord(raw);
  const id = cleanString(input.id);
  const label = cleanString(input.label);
  requireRule(
    Boolean(id && label),
    "invalid_option",
    "Dialogue option id and label are required",
  );
  const option: DialogueOption = {
    id: id!,
    label: label!,
    effects: normalizeEffects(input.effects),
  };
  const eligibilityInput = asRecord(input.eligibility);
  if (Object.keys(eligibilityInput).length > 0) {
    const memberIds = uniqueStrings(eligibilityInput.memberIds).filter(
      (memberId) => participantIds.includes(memberId),
    );
    const requiredFlags: Record<string, PartyFlagValue> = {};
    normalizeFlags(eligibilityInput.requiredFlags, requiredFlags);
    const rep = asRecord(eligibilityInput.minimumReputation);
    const factionId = cleanString(rep.factionId);
    const value = integer(rep.value);
    option.eligibility = {
      memberIds: memberIds.length > 0 ? memberIds : undefined,
      requiredFlags:
        Object.keys(requiredFlags).length > 0 ? requiredFlags : undefined,
      minimumReputation:
        factionId && value !== null ? { factionId, value } : undefined,
    };
  }
  const check = normalizeCheck(input.check, participantIds);
  if (check) option.check = check;
  return option;
}

function normalizeCheck(
  raw: unknown,
  participants: string[],
): DialogueCheck | null {
  const input = asRecord(raw);
  const skill = cleanString(input.skill);
  const dc = positiveInteger(input.dc);
  if (!skill || dc === null) return null;
  const eligibleMemberIds = uniqueStrings(input.eligibleMemberIds).filter(
    (id) => participants.includes(id),
  );
  return {
    skill,
    dc,
    eligibleMemberIds:
      eligibleMemberIds.length > 0 ? eligibleMemberIds : undefined,
    allowAssist: input.allowAssist === true,
    maxAssistants:
      input.allowAssist === true
        ? (nonNegativeInteger(input.maxAssistants) ?? 1)
        : 0,
  };
}

function normalizeEffects(raw: unknown): PartyEffect[] {
  const effects: PartyEffect[] = [];
  for (const value of recordOrArrayValues(raw)) {
    const input = asRecord(value);
    if (input.type === "set_flag") {
      const key = cleanString(input.key);
      if (key && isFlagValue(input.value))
        effects.push({ type: "set_flag", key, value: input.value });
    } else if (input.type === "adjust_reputation") {
      const factionId = cleanString(input.factionId);
      const amount = integer(input.amount);
      if (factionId && amount !== null && amount !== 0)
        effects.push({ type: "adjust_reputation", factionId, amount });
    } else if (input.type === "set_quest_status") {
      const questId = cleanString(input.questId);
      if (questId && isQuestStatus(input.status))
        effects.push({
          type: "set_quest_status",
          questId,
          status: input.status,
        });
    } else if (input.type === "set_objective") {
      const questId = cleanString(input.questId);
      const objectiveId = cleanString(input.objectiveId);
      const status = isObjectiveStatus(input.status) ? input.status : undefined;
      const progress = nonNegativeInteger(input.progress) ?? undefined;
      if (
        questId &&
        objectiveId &&
        (status !== undefined || progress !== undefined)
      ) {
        effects.push({
          type: "set_objective",
          questId,
          objectiveId,
          status,
          progress,
        });
      }
    }
  }
  return effects;
}

function normalizeUseEffect(
  raw: unknown,
): InventoryItemInstance["useEffect"] | undefined {
  const input = asRecord(raw);
  const resourceId = cleanString(input.resourceId);
  const amount = positiveInteger(input.amount);
  if (input.type !== "restore_resource" || !resourceId || amount === null)
    return undefined;
  return { type: "restore_resource", resourceId, amount };
}

function compatibleStacks(
  state: PartyRuntimeState,
  item: Pick<InventoryItemInstance, "definitionId" | "stackKey" | "maxStack">,
  holderId: InventoryHolderId,
): InventoryItemInstance[] {
  if (!item.stackKey || item.maxStack <= 1) return [];
  return Object.values(state.inventory)
    .filter(
      (candidate) =>
        candidate.holderId === holderId &&
        !candidate.equipped &&
        candidate.definitionId === item.definitionId &&
        candidate.stackKey === item.stackKey &&
        candidate.maxStack === item.maxStack &&
        candidate.quantity < candidate.maxStack,
    )
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
}

function evaluateRestVote(proposal: RestProposal): void {
  const total = proposal.eligibleMemberIds.length;
  const threshold =
    proposal.policy === "unanimous" ? total : Math.floor(total / 2) + 1;
  const yes = Object.values(proposal.votes).filter(Boolean).length;
  const no = Object.values(proposal.votes).filter((vote) => !vote).length;
  if (yes >= threshold) proposal.status = "accepted";
  else if (no > total - threshold) proposal.status = "rejected";
}

function eligibilityReasons(
  state: PartyRuntimeState,
  option: DialogueOption,
  memberId: string,
): string[] {
  const reasons: string[] = [];
  const eligibility = option.eligibility;
  if (!eligibility) return reasons;
  if (eligibility.memberIds && !eligibility.memberIds.includes(memberId))
    reasons.push("member_not_eligible");
  for (const [key, expected] of Object.entries(
    eligibility.requiredFlags ?? {},
  )) {
    if (state.flags[key] !== expected) reasons.push(`flag:${key}`);
  }
  const minimum = eligibility.minimumReputation;
  if (minimum && (state.reputation[minimum.factionId] ?? 0) < minimum.value) {
    reasons.push(`reputation:${minimum.factionId}`);
  }
  return reasons;
}

function checkerEligible(check: DialogueCheck, memberId: string): boolean {
  return !check.eligibleMemberIds || check.eligibleMemberIds.includes(memberId);
}

function requireMember(
  state: PartyRuntimeState,
  memberId: string,
): PartyMember {
  const member = state.members[memberId];
  requireRule(
    Boolean(member),
    "member_not_found",
    `Party member ${memberId} was not found`,
  );
  requireRule(
    member!.active,
    "member_inactive",
    `Party member ${memberId} is inactive`,
  );
  return member!;
}

function requireHolder(
  state: PartyRuntimeState,
  holderId: InventoryHolderId,
): void {
  if (holderId !== "party") requireMember(state, holderId);
}

function requireItem(
  state: PartyRuntimeState,
  itemId: string,
): InventoryItemInstance {
  const item = state.inventory[itemId];
  requireRule(
    Boolean(item),
    "item_not_found",
    `Inventory item ${itemId} was not found`,
  );
  return item!;
}

function requireRest(
  state: PartyRuntimeState,
  proposalId: string,
): RestProposal {
  const proposal = state.restProposals[proposalId];
  requireRule(
    Boolean(proposal),
    "rest_not_found",
    `Rest proposal ${proposalId} was not found`,
  );
  return proposal!;
}

function requireQuest(
  state: PartyRuntimeState,
  questId: string,
): StructuredQuest {
  const quest = state.quests[questId];
  requireRule(
    Boolean(quest),
    "quest_not_found",
    `Quest ${questId} was not found`,
  );
  return quest!;
}

function requireOpenDialogue(
  state: PartyRuntimeState,
  decisionId: string,
): DialogueDecision {
  const decision = state.dialogues[decisionId];
  requireRule(
    Boolean(decision),
    "dialogue_not_found",
    `Dialogue ${decisionId} was not found`,
  );
  requireRule(
    decision!.status === "open",
    "dialogue_closed",
    `Dialogue ${decisionId} is closed`,
  );
  return decision!;
}

function requireDialogueOption(
  decision: DialogueDecision,
  optionId: string,
): DialogueOption {
  const option = decision.options[optionId];
  requireRule(
    Boolean(option),
    "option_not_found",
    `Dialogue option ${optionId} was not found`,
  );
  return option!;
}

function requireRule(
  condition: unknown,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new RuleViolation(code, message, details);
}

function requirePositiveInteger(value: number, code: string): void {
  requireRule(
    Number.isInteger(value) && value > 0,
    code,
    "Value must be a positive integer",
  );
}

function requireQuestStatus(value: unknown): asserts value is QuestStatus {
  requireRule(
    isQuestStatus(value),
    "invalid_quest_status",
    "Quest status is invalid",
  );
}

function requireObjectiveStatus(
  value: unknown,
): asserts value is ObjectiveStatus {
  requireRule(
    isObjectiveStatus(value),
    "invalid_objective_status",
    "Objective status is invalid",
  );
}

function failed(
  state: PartyRuntimeState,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PartyReducerResult {
  return { ok: false, state, events: [], error: { code, message, details } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordOrArrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return Object.values(asRecord(value));
}

function recordOrArrayEntries(
  value: unknown,
): Array<[string | number, unknown]> {
  if (Array.isArray(value)) return value.map((entry, index) => [index, entry]);
  return Object.entries(asRecord(value));
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.map(cleanString).filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}

function isFlagValue(value: unknown): value is PartyFlagValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isQuestStatus(value: unknown): value is QuestStatus {
  return (
    value === "inactive" ||
    value === "active" ||
    value === "completed" ||
    value === "failed"
  );
}

function questStatus(value: unknown): QuestStatus {
  return isQuestStatus(value) ? value : "active";
}

function isObjectiveStatus(value: unknown): value is ObjectiveStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "completed" ||
    value === "failed"
  );
}

function objectiveStatus(value: unknown): ObjectiveStatus {
  return isObjectiveStatus(value) ? value : "pending";
}

function restStatus(value: unknown): RestProposal["status"] {
  return value === "accepted" ||
    value === "rejected" ||
    value === "completed" ||
    value === "cancelled"
    ? value
    : "proposed";
}

function checkOutcomeValue(
  value: unknown,
): DialogueResolution["checkOutcome"] | null {
  return value === "critical_failure" ||
    value === "failure" ||
    value === "success" ||
    value === "critical_success"
    ? value
    : null;
}
