import { describe, expect, it } from "vitest";
import {
  PARTY_STATE_VERSION,
  UnsupportedPartyStateVersionError,
  createPartyState,
  dialogueOptionEligibility,
  dialogueViewFor,
  normalizePartyState,
  reducePartyState,
  type InventoryItemGrant,
  type PartyCommand,
  type PartyReducerResult,
  type PartyRuntimeState,
  type StructuredQuest,
} from "./party";

const members = [
  { id: "mara", name: "Mara" },
  { id: "lias", name: "Lias" },
  { id: "elinor", name: "Elinor" },
  { id: "soren", name: "Soren" },
];

function freshState(): PartyRuntimeState {
  return createPartyState(members);
}

function apply(
  state: PartyRuntimeState,
  command: PartyCommand,
): Extract<PartyReducerResult, { ok: true }> {
  const result = reducePartyState(state, command);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result;
}

function potion(instanceId: string, quantity: number): InventoryItemGrant {
  return {
    instanceId,
    definitionId: "healing-potion",
    name: "Healing potion",
    quantity,
    maxStack: 5,
    stackKey: "potion:healing",
    equippableSlots: [],
    usable: true,
    useEffect: { type: "restore_resource", resourceId: "hp", amount: 4 },
  };
}

const quest: StructuredQuest = {
  id: "missing-scout",
  title: "Find the missing scout",
  status: "active",
  objectiveOrder: ["tracks", "return"],
  objectives: {
    tracks: {
      id: "tracks",
      title: "Follow three tracks",
      status: "active",
      progress: 0,
      target: 3,
      optional: false,
    },
    return: {
      id: "return",
      title: "Return to the gate",
      status: "pending",
      progress: 0,
      target: 1,
      optional: false,
    },
  },
};

describe("party state migration and command protocol", () => {
  it("migrates a v1 snapshot and normalizes unsafe runtime values", () => {
    const state = normalizePartyState({
      version: 1,
      revision: 7,
      members: [{ id: "mara", name: " Mara " }],
      inventory: [
        {
          id: "arrows",
          itemId: "arrow",
          ownerId: "mara",
          name: "Arrows",
          quantity: 99,
          maxStack: 20,
          stackKey: "arrow",
        },
      ],
      questFlags: { rescued: true, invalid: { nested: true } },
      reputations: { grove: 4.8 },
    });

    expect(state).toMatchObject({
      version: PARTY_STATE_VERSION,
      revision: 7,
      members: { mara: { id: "mara", name: "Mara", active: true } },
      flags: { rescued: true },
      reputation: { grove: 4 },
    });
    expect(state.inventory.arrows).toMatchObject({
      definitionId: "arrow",
      holderId: "mara",
      quantity: 20,
      maxStack: 20,
    });
  });

  it("refuses to downgrade a state created by a newer rules engine", () => {
    expect(() => normalizePartyState({ version: 99 })).toThrowError(
      UnsupportedPartyStateVersionError,
    );
  });

  it("deduplicates successful commands without another revision or event", () => {
    const first = apply(freshState(), {
      type: "flag.set",
      commandId: "set-flag-once",
      key: "door_open",
      value: true,
    });
    const duplicate = reducePartyState(first.state, {
      type: "flag.set",
      commandId: "set-flag-once",
      key: "door_open",
      value: false,
    });

    expect(duplicate).toMatchObject({
      ok: true,
      duplicate: true,
      events: [],
      state: { revision: 1, flags: { door_open: true } },
    });
  });

  it("returns stable errors and never commits a partially-invalid command", () => {
    const state = freshState();
    const result = reducePartyState(state, {
      type: "resource.spend",
      commandId: "missing-resource",
      memberId: "mara",
      resourceId: "spell-1",
      amount: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "resource_not_found" },
      state: { revision: 0, processedCommands: {} },
      events: [],
    });
  });
});

describe("inventory, equipment, and consumable resources", () => {
  it("merges existing stacks and deterministically splits overflow loot", () => {
    let state = apply(freshState(), {
      type: "inventory.loot",
      commandId: "loot-1",
      holderId: "party",
      items: [potion("potions-a", 4)],
    }).state;
    const second = apply(state, {
      type: "inventory.loot",
      commandId: "loot-2",
      holderId: "party",
      items: [potion("potions-b", 9)],
    });
    state = second.state;

    expect(state.inventory).toMatchObject({
      "potions-a": { quantity: 5 },
      "potions-b": { quantity: 5 },
      "potions-b:1": { quantity: 3 },
    });
    expect(second.events[0]).toMatchObject({
      type: "inventory_looted",
      payload: {
        quantity: 9,
        mergedInto: ["potions-a"],
        created: ["potions-b", "potions-b:1"],
      },
    });
  });

  it("partially transfers a stack, merging first and creating a supplied instance", () => {
    let state = apply(freshState(), {
      type: "inventory.loot",
      commandId: "loot-party",
      holderId: "party",
      items: [potion("party-potions", 5)],
    }).state;
    state = apply(state, {
      type: "inventory.loot",
      commandId: "loot-mara",
      holderId: "mara",
      items: [potion("mara-potions", 4)],
    }).state;
    const transfer = apply(state, {
      type: "inventory.transfer",
      commandId: "give-mara-three",
      itemId: "party-potions",
      toHolderId: "mara",
      quantity: 3,
      newInstanceId: "mara-potions-2",
    });

    expect(transfer.state.inventory).toMatchObject({
      "party-potions": { holderId: "party", quantity: 2 },
      "mara-potions": { holderId: "mara", quantity: 5 },
      "mara-potions-2": { holderId: "mara", quantity: 2 },
    });
    expect(transfer.events[0]?.payload).toMatchObject({
      fromHolderId: "party",
      toHolderId: "mara",
      quantity: 3,
      mergedInto: ["mara-potions"],
      createdItemId: "mara-potions-2",
    });
  });

  it("equips a held item and automatically returns the replaced item to inventory", () => {
    const sword = (instanceId: string): InventoryItemGrant => ({
      instanceId,
      definitionId: instanceId,
      name: instanceId,
      quantity: 1,
      maxStack: 1,
      equippableSlots: ["main-hand"],
      usable: false,
    });
    let state = apply(freshState(), {
      type: "inventory.loot",
      commandId: "loot-swords",
      holderId: "mara",
      items: [sword("iron-sword"), sword("silver-sword")],
    }).state;
    state = apply(state, {
      type: "inventory.equip",
      commandId: "equip-iron",
      memberId: "mara",
      itemId: "iron-sword",
      slot: "main-hand",
    }).state;
    const replaced = apply(state, {
      type: "inventory.equip",
      commandId: "equip-silver",
      memberId: "mara",
      itemId: "silver-sword",
      slot: "main-hand",
    });

    expect(replaced.state.equipment.mara["main-hand"]).toBe("silver-sword");
    expect(replaced.state.inventory["iron-sword"].equipped).toBeUndefined();
    expect(replaced.state.inventory["silver-sword"].equipped).toEqual({
      memberId: "mara",
      slot: "main-hand",
    });
    expect(replaced.events.map((event) => event.type)).toEqual([
      "inventory_unequipped",
      "inventory_equipped",
    ]);
  });

  it("consumes an item, restores its configured resource, and removes an empty stack", () => {
    let state = apply(freshState(), {
      type: "resource.define",
      commandId: "define-hp",
      memberId: "mara",
      resource: {
        id: "hp",
        label: "Hit points",
        kind: "health",
        current: 3,
        max: 10,
        resetOn: "long",
      },
    }).state;
    state = apply(state, {
      type: "inventory.loot",
      commandId: "loot-single-potion",
      holderId: "mara",
      items: [potion("one-potion", 1)],
    }).state;
    const used = apply(state, {
      type: "inventory.use",
      commandId: "drink",
      memberId: "mara",
      itemId: "one-potion",
    });

    expect(used.state.resources.mara.hp.current).toBe(7);
    expect(used.state.inventory["one-potion"]).toBeUndefined();
    expect(used.events.map((event) => event.type)).toEqual([
      "resource_restored",
      "inventory_used",
    ]);
  });

  it("rejects overspending while retaining the original resource value", () => {
    const state = apply(freshState(), {
      type: "resource.define",
      commandId: "define-slot",
      memberId: "elinor",
      resource: {
        id: "spell-2",
        label: "Level 2 spell slots",
        kind: "spell_slot",
        level: 2,
        current: 1,
        max: 2,
        resetOn: "long",
      },
    }).state;
    const result = reducePartyState(state, {
      type: "resource.spend",
      commandId: "overspend",
      memberId: "elinor",
      resourceId: "spell-2",
      amount: 2,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "insufficient_resource" },
      state: { resources: { elinor: { "spell-2": { current: 1 } } } },
    });
  });
});

describe("rest proposals and recovery", () => {
  it("requires the configured household vote and resets only short-rest pools", () => {
    let state = freshState();
    for (const [memberId, resourceId, resetOn] of [
      ["mara", "second-wind", "short"],
      ["mara", "spell-1", "long"],
    ] as const) {
      state = apply(state, {
        type: "resource.define",
        commandId: `define-${resourceId}`,
        memberId,
        resource: {
          id: resourceId,
          label: resourceId,
          kind: resourceId.startsWith("spell") ? "spell_slot" : "class",
          current: 0,
          max: 1,
          resetOn,
        },
      }).state;
    }
    state = apply(state, {
      type: "rest.propose",
      commandId: "propose-rest",
      proposalId: "rest-1",
      restType: "short",
      proposerId: "mara",
      eligibleMemberIds: ["mara", "lias", "elinor", "soren"],
      policy: "unanimous",
    }).state;
    expect(state.restProposals["rest-1"].status).toBe("proposed");

    for (const memberId of ["lias", "elinor", "soren"]) {
      state = apply(state, {
        type: "rest.vote",
        commandId: `vote-${memberId}`,
        proposalId: "rest-1",
        memberId,
        approve: true,
      }).state;
    }
    expect(state.restProposals["rest-1"].status).toBe("accepted");

    const completed = apply(state, {
      type: "rest.complete",
      commandId: "complete-rest",
      proposalId: "rest-1",
    });
    expect(completed.state.resources.mara["second-wind"].current).toBe(1);
    expect(completed.state.resources.mara["spell-1"].current).toBe(0);
    expect(completed.state.restProposals["rest-1"]).toMatchObject({
      status: "completed",
      completedRevision: completed.state.revision,
    });
    expect(completed.state.activeRestId).toBeNull();
  });

  it("rejects a unanimous rest immediately after a no vote", () => {
    let state = apply(freshState(), {
      type: "rest.propose",
      commandId: "propose-rest",
      proposalId: "rest-no",
      restType: "long",
      proposerId: "mara",
      eligibleMemberIds: ["mara", "lias"],
    }).state;
    const vote = apply(state, {
      type: "rest.vote",
      commandId: "vote-no",
      proposalId: "rest-no",
      memberId: "lias",
      approve: false,
    });
    state = vote.state;

    expect(state.restProposals["rest-no"].status).toBe("rejected");
    expect(state.activeRestId).toBeNull();
    expect(vote.events.map((event) => event.type)).toContain("rest_rejected");
  });
});

describe("structured quests, flags, and reputation", () => {
  it("tracks objective progress and completes a quest when all required objectives finish", () => {
    let state = apply(freshState(), {
      type: "quest.upsert",
      commandId: "add-quest",
      quest,
    }).state;
    state = apply(state, {
      type: "quest.setObjective",
      commandId: "finish-tracks",
      questId: quest.id,
      objectiveId: "tracks",
      progress: 3,
    }).state;
    const completed = apply(state, {
      type: "quest.setObjective",
      commandId: "finish-return",
      questId: quest.id,
      objectiveId: "return",
      status: "completed",
    });

    expect(completed.state.quests[quest.id]).toMatchObject({
      status: "completed",
      objectives: {
        tracks: { progress: 3, status: "completed" },
        return: { status: "completed" },
      },
    });
    expect(completed.events.map((event) => event.type)).toEqual([
      "quest_objective_changed",
      "quest_status_changed",
    ]);
  });

  it("stores typed world flags and accumulates faction reputation", () => {
    let state = apply(freshState(), {
      type: "flag.set",
      commandId: "flag-rescue",
      key: "scout_rescued",
      value: true,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "rep-one",
      factionId: "watch",
      amount: 3,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "rep-two",
      factionId: "watch",
      amount: -1,
    }).state;

    expect(state.flags.scout_rescued).toBe(true);
    expect(state.reputation.watch).toBe(2);
  });
});

describe("cooperative dialogue decisions", () => {
  function openDecision(state = freshState()): PartyRuntimeState {
    return apply(state, {
      type: "dialogue.open",
      commandId: "open-gate-dialogue",
      decision: {
        id: "gate-dialogue",
        prompt: "How do you enter?",
        participantIds: ["mara", "lias", "elinor", "soren"],
        speakerId: "mara",
        resolutionMode: "majority",
        options: [
          {
            id: "persuade",
            label: "Persuade the guard",
            eligibility: {
              requiredFlags: { knows_password: true },
              minimumReputation: { factionId: "watch", value: 2 },
            },
            check: {
              skill: "persuasion",
              dc: 14,
              eligibleMemberIds: ["mara", "elinor"],
              allowAssist: true,
              maxAssistants: 1,
            },
            effects: [
              { type: "set_flag", key: "gate_open", value: true },
              { type: "adjust_reputation", factionId: "watch", amount: 1 },
            ],
          },
          { id: "leave", label: "Leave", effects: [] },
        ],
      },
    }).state;
  }

  it("evaluates option eligibility against flags and reputation", () => {
    let state = openDecision();
    expect(
      dialogueOptionEligibility(state, "gate-dialogue", "persuade", "mara"),
    ).toEqual({
      eligible: false,
      reasons: ["flag:knows_password", "reputation:watch"],
    });
    state = apply(state, {
      type: "flag.set",
      commandId: "learn-password",
      key: "knows_password",
      value: true,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "earn-trust",
      factionId: "watch",
      amount: 2,
    }).state;

    expect(
      dialogueOptionEligibility(state, "gate-dialogue", "persuade", "mara"),
    ).toEqual({ eligible: true, reasons: [] });
  });

  it("keeps secret ballots out of events and other players' views", () => {
    const state = openDecision();
    const voted = apply(state, {
      type: "dialogue.vote",
      commandId: "secret-vote",
      decisionId: "gate-dialogue",
      memberId: "lias",
      optionId: "leave",
      secret: true,
    });

    expect(voted.events[0]).toEqual({
      type: "dialogue_vote_cast",
      revision: voted.state.revision,
      payload: { decisionId: "gate-dialogue", memberId: "lias", secret: true },
    });
    expect(
      dialogueViewFor(voted.state, "gate-dialogue", "mara")?.votes.lias,
    ).toEqual({ optionId: null, secret: true });
    expect(
      dialogueViewFor(voted.state, "gate-dialogue", "lias")?.votes.lias,
    ).toEqual({ optionId: "leave", secret: true });
  });

  it("uses the speaker's ballot as a deterministic majority tie-break", () => {
    let state = apply(freshState(), {
      type: "flag.set",
      commandId: "tie-password",
      key: "knows_password",
      value: true,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "tie-reputation",
      factionId: "watch",
      amount: 2,
    }).state;
    state = openDecision(state);
    state = apply(state, {
      type: "dialogue.vote",
      commandId: "mara-leaves",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "leave",
    }).state;
    state = apply(state, {
      type: "dialogue.vote",
      commandId: "lias-persuades",
      decisionId: "gate-dialogue",
      memberId: "lias",
      optionId: "persuade",
    }).state;
    const resolved = apply(state, {
      type: "dialogue.resolve",
      commandId: "resolve-tie",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "leave",
    });

    expect(resolved.state.dialogues["gate-dialogue"].resolution).toMatchObject({
      optionId: "leave",
      speakerId: "mara",
      voteTally: { persuade: 1, leave: 1 },
    });
  });

  it("delegates and assists a checked option, applies effects, and resolves idempotently", () => {
    let state = freshState();
    state = apply(state, {
      type: "flag.set",
      commandId: "knows-password",
      key: "knows_password",
      value: true,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "trusted",
      factionId: "watch",
      amount: 2,
    }).state;
    state = openDecision(state);
    for (const [memberId, optionId] of [
      ["mara", "persuade"],
      ["lias", "persuade"],
      ["elinor", "persuade"],
    ] as const) {
      state = apply(state, {
        type: "dialogue.vote",
        commandId: `vote-${memberId}`,
        decisionId: "gate-dialogue",
        memberId,
        optionId,
      }).state;
    }
    state = apply(state, {
      type: "dialogue.delegateCheck",
      commandId: "delegate-check",
      decisionId: "gate-dialogue",
      optionId: "persuade",
      delegatorId: "mara",
      memberId: "elinor",
    }).state;
    state = apply(state, {
      type: "dialogue.assist",
      commandId: "assist-check",
      decisionId: "gate-dialogue",
      optionId: "persuade",
      memberId: "lias",
      enabled: true,
    }).state;
    const resolved = apply(state, {
      type: "dialogue.resolve",
      commandId: "resolve-persuasion",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "persuade",
      checkOutcome: "success",
    });

    expect(resolved.state.dialogues["gate-dialogue"]).toMatchObject({
      status: "resolved",
      resolution: {
        optionId: "persuade",
        checkerId: "elinor",
        assistants: ["lias"],
        checkOutcome: "success",
      },
    });
    expect(resolved.state.flags.gate_open).toBe(true);
    expect(resolved.state.reputation.watch).toBe(3);
    expect(resolved.events.map((event) => event.type)).toEqual([
      "flag_set",
      "reputation_changed",
      "dialogue_resolved",
    ]);

    const retried = reducePartyState(resolved.state, {
      type: "dialogue.resolve",
      commandId: "retry-with-new-id",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "persuade",
      checkOutcome: "success",
    });
    expect(retried).toMatchObject({
      ok: true,
      duplicate: true,
      events: [],
      state: { revision: resolved.state.revision, reputation: { watch: 3 } },
    });
  });

  it("records a failed dialogue check without applying success effects", () => {
    let state = apply(freshState(), {
      type: "flag.set",
      commandId: "failure-password",
      key: "knows_password",
      value: true,
    }).state;
    state = apply(state, {
      type: "reputation.adjust",
      commandId: "failure-trust",
      factionId: "watch",
      amount: 2,
    }).state;
    state = openDecision(state);
    state = apply(state, {
      type: "dialogue.vote",
      commandId: "failure-vote",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "persuade",
    }).state;

    const resolved = apply(state, {
      type: "dialogue.resolve",
      commandId: "failure-resolve",
      decisionId: "gate-dialogue",
      memberId: "mara",
      optionId: "persuade",
      checkOutcome: "failure",
    });

    expect(resolved.state.flags.gate_open).toBeUndefined();
    expect(resolved.state.reputation.watch).toBe(2);
    expect(resolved.events).toHaveLength(1);
    expect(resolved.events[0]).toMatchObject({
      type: "dialogue_resolved",
      payload: { checkOutcome: "failure", effectsApplied: false },
    });
  });

  it("rejects a resolution from anyone other than the current speaker", () => {
    const state = openDecision();
    const result = reducePartyState(state, {
      type: "dialogue.resolve",
      commandId: "wrong-resolver",
      decisionId: "gate-dialogue",
      memberId: "lias",
      optionId: "leave",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "speaker_required" },
      state: { dialogues: { "gate-dialogue": { status: "open" } } },
    });
  });
});
