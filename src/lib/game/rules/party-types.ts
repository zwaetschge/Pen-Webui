export const PARTY_STATE_VERSION = 2 as const;

export type PartyFlagValue = string | number | boolean | null;
export type InventoryHolderId = string | "party";
export type RestType = "short" | "long";
export type ResourceReset = "short" | "long" | "none";
export type QuestStatus =
  | "inactive"
  | "active"
  | "completed"
  | "failed";
export type ObjectiveStatus = "pending" | "active" | "completed" | "failed";

export type PartyMember = {
  id: string;
  name: string;
  active: boolean;
};

export type ItemUseEffect = {
  type: "restore_resource";
  resourceId: string;
  amount: number;
};

export type InventoryItemInstance = {
  instanceId: string;
  definitionId: string;
  name: string;
  holderId: InventoryHolderId;
  quantity: number;
  maxStack: number;
  stackKey?: string;
  equippableSlots: string[];
  usable: boolean;
  useEffect?: ItemUseEffect;
  equipped?: {
    memberId: string;
    slot: string;
  };
};

export type PartyResource = {
  id: string;
  label: string;
  kind: "spell_slot" | "class" | "health" | "other";
  current: number;
  max: number;
  resetOn: ResourceReset;
  level?: number;
};

export type RestProposal = {
  id: string;
  type: RestType;
  proposerId: string;
  eligibleMemberIds: string[];
  policy: "unanimous" | "majority";
  votes: Record<string, boolean>;
  status: "proposed" | "accepted" | "rejected" | "completed" | "cancelled";
  completedRevision?: number;
};

export type QuestObjective = {
  id: string;
  title: string;
  status: ObjectiveStatus;
  progress: number;
  target: number;
  optional: boolean;
};

export type StructuredQuest = {
  id: string;
  title: string;
  description?: string;
  status: QuestStatus;
  objectiveOrder: string[];
  objectives: Record<string, QuestObjective>;
};

export type DialogueCheck = {
  skill: string;
  dc: number;
  eligibleMemberIds?: string[];
  allowAssist: boolean;
  maxAssistants: number;
};

export type DialogueEligibility = {
  memberIds?: string[];
  requiredFlags?: Record<string, PartyFlagValue>;
  minimumReputation?: {
    factionId: string;
    value: number;
  };
};

export type PartyEffect =
  | {
      type: "set_flag";
      key: string;
      value: PartyFlagValue;
    }
  | {
      type: "adjust_reputation";
      factionId: string;
      amount: number;
    }
  | {
      type: "set_quest_status";
      questId: string;
      status: QuestStatus;
    }
  | {
      type: "set_objective";
      questId: string;
      objectiveId: string;
      status?: ObjectiveStatus;
      progress?: number;
    };

export type DialogueOption = {
  id: string;
  label: string;
  eligibility?: DialogueEligibility;
  check?: DialogueCheck;
  effects: PartyEffect[];
};

export type DialogueVote = {
  optionId: string;
  secret: boolean;
};

export type DialogueCheckAssignment = {
  memberId: string;
  assistants: string[];
};

export type DialogueResolution = {
  optionId: string;
  speakerId: string;
  voteTally: Record<string, number>;
  checkerId?: string;
  assistants: string[];
  checkOutcome?:
    | "critical_failure"
    | "failure"
    | "success"
    | "critical_success";
};

export type DialogueDecision = {
  id: string;
  prompt: string;
  participantIds: string[];
  speakerId: string;
  resolutionMode: "speaker" | "majority";
  optionOrder: string[];
  options: Record<string, DialogueOption>;
  votes: Record<string, DialogueVote>;
  checkAssignments: Record<string, DialogueCheckAssignment>;
  status: "open" | "resolved" | "cancelled";
  resolution?: DialogueResolution;
};

export type PartyRuntimeState = {
  version: typeof PARTY_STATE_VERSION;
  revision: number;
  members: Record<string, PartyMember>;
  inventory: Record<string, InventoryItemInstance>;
  equipment: Record<string, Record<string, string>>;
  resources: Record<string, Record<string, PartyResource>>;
  restProposals: Record<string, RestProposal>;
  activeRestId: string | null;
  quests: Record<string, StructuredQuest>;
  flags: Record<string, PartyFlagValue>;
  reputation: Record<string, number>;
  dialogues: Record<string, DialogueDecision>;
  processedCommands: Record<string, number>;
};

export type InventoryItemGrant = Omit<
  InventoryItemInstance,
  "holderId" | "equipped"
>;

export type DialogueDecisionInput = Pick<
  DialogueDecision,
  | "id"
  | "prompt"
  | "participantIds"
  | "speakerId"
  | "resolutionMode"
> & {
  options: DialogueOption[];
};

type CommandBase = { commandId: string };

export type PartyCommand =
  | (CommandBase & {
      type: "inventory.loot";
      holderId: InventoryHolderId;
      items: InventoryItemGrant[];
    })
  | (CommandBase & {
      type: "inventory.transfer";
      itemId: string;
      toHolderId: InventoryHolderId;
      quantity?: number;
      newInstanceId?: string;
    })
  | (CommandBase & {
      type: "inventory.equip";
      memberId: string;
      itemId: string;
      slot: string;
    })
  | (CommandBase & {
      type: "inventory.unequip";
      memberId: string;
      slot: string;
    })
  | (CommandBase & {
      type: "inventory.use";
      memberId: string;
      itemId: string;
      quantity?: number;
    })
  | (CommandBase & {
      type: "resource.define";
      memberId: string;
      resource: PartyResource;
    })
  | (CommandBase & {
      type: "resource.spend";
      memberId: string;
      resourceId: string;
      amount?: number;
    })
  | (CommandBase & {
      type: "resource.restore";
      memberId: string;
      resourceId: string;
      amount?: number;
    })
  | (CommandBase & {
      type: "rest.propose";
      proposalId: string;
      restType: RestType;
      proposerId: string;
      eligibleMemberIds?: string[];
      policy?: "unanimous" | "majority";
    })
  | (CommandBase & {
      type: "rest.vote";
      proposalId: string;
      memberId: string;
      approve: boolean;
    })
  | (CommandBase & {
      type: "rest.complete";
      proposalId: string;
    })
  | (CommandBase & {
      type: "rest.cancel";
      proposalId: string;
      memberId: string;
    })
  | (CommandBase & {
      type: "quest.upsert";
      quest: StructuredQuest;
    })
  | (CommandBase & {
      type: "quest.setStatus";
      questId: string;
      status: QuestStatus;
    })
  | (CommandBase & {
      type: "quest.setObjective";
      questId: string;
      objectiveId: string;
      status?: ObjectiveStatus;
      progress?: number;
    })
  | (CommandBase & {
      type: "flag.set";
      key: string;
      value: PartyFlagValue;
    })
  | (CommandBase & {
      type: "reputation.adjust";
      factionId: string;
      amount: number;
    })
  | (CommandBase & {
      type: "dialogue.open";
      decision: DialogueDecisionInput;
    })
  | (CommandBase & {
      type: "dialogue.setSpeaker";
      decisionId: string;
      speakerId: string;
    })
  | (CommandBase & {
      type: "dialogue.vote";
      decisionId: string;
      memberId: string;
      optionId: string;
      secret?: boolean;
    })
  | (CommandBase & {
      type: "dialogue.delegateCheck";
      decisionId: string;
      optionId: string;
      delegatorId: string;
      memberId: string;
    })
  | (CommandBase & {
      type: "dialogue.assist";
      decisionId: string;
      optionId: string;
      memberId: string;
      enabled: boolean;
    })
  | (CommandBase & {
      type: "dialogue.resolve";
      decisionId: string;
      memberId: string;
      optionId?: string;
      checkOutcome?: DialogueResolution["checkOutcome"];
    })
  | (CommandBase & {
      type: "dialogue.cancel";
      decisionId: string;
      memberId: string;
    });

export type PartyDomainEvent = {
  type: string;
  revision: number;
  payload: Record<string, unknown>;
};

export type PartyRuleError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type PartyReducerResult =
  | {
      ok: true;
      state: PartyRuntimeState;
      events: PartyDomainEvent[];
      duplicate: boolean;
    }
  | {
      ok: false;
      state: PartyRuntimeState;
      events: [];
      error: PartyRuleError;
    };

export type DialogueView = Omit<DialogueDecision, "votes"> & {
  votes: Record<
    string,
    {
      optionId: string | null;
      secret: boolean;
    }
  >;
};
