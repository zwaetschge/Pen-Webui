import type {
  StoredVoiceAssignment,
  VoiceTarget,
  VoiceTargetType,
} from "./types";

export const NARRATOR_TARGET_ID = "narrator";

export type ReadableEventLog = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

export type ReadableTtsEvent = {
  eventId: string;
  text: string;
  target: VoiceTarget;
};

export type ResolvedVoice = {
  voiceId: string;
  voiceName: string;
  voiceSource: "clone";
  vocariumUser: string;
  fallback?: "narrator" | "default";
};

export function readableEventFromLog(
  event: ReadableEventLog,
): ReadableTtsEvent | null {
  const text = stringField(event.payload.text);
  if (!text) return null;

  if (event.type === "narrate") {
    const speakerNpcId = stringField(event.payload.speakerNpcId);
    return {
      eventId: event.id,
      text,
      target: speakerNpcId
        ? { targetType: "npc", targetId: speakerNpcId }
        : { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    };
  }

  if (event.type === "player_input") {
    const characterId = stringField(event.payload.characterId);
    return {
      eventId: event.id,
      text,
      target: characterId
        ? { targetType: "character", targetId: characterId }
        : { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    };
  }

  return null;
}

export function resolveVoiceForTarget(input: {
  target: VoiceTarget;
  assignments: StoredVoiceAssignment[];
  vocariumUser: string;
}): ResolvedVoice {
  const exact = findAssignment(input.assignments, input.target);
  if (exact) return fromAssignment(exact);

  const narrator = findAssignment(input.assignments, {
    targetType: "narrator",
    targetId: NARRATOR_TARGET_ID,
  });
  if (narrator) return { ...fromAssignment(narrator), fallback: "narrator" };

  return {
    voiceId: "default",
    voiceName: "Default",
    voiceSource: "clone",
    vocariumUser: input.vocariumUser,
    fallback: "default",
  };
}

function findAssignment(
  assignments: StoredVoiceAssignment[],
  target: { targetType: VoiceTargetType; targetId: string },
) {
  return assignments.find(
    (assignment) =>
      assignment.targetType === target.targetType &&
      assignment.targetId === target.targetId,
  );
}

function fromAssignment(assignment: StoredVoiceAssignment): ResolvedVoice {
  return {
    voiceId: assignment.voiceId,
    voiceName: assignment.voiceName,
    voiceSource: "clone",
    vocariumUser: assignment.vocariumUser,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
