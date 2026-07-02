import type { ChatLine, SceneState } from "./store";

type NarrationLine = Extract<ChatLine, { kind: "narrate" }>;
type PlayerLine = Extract<ChatLine, { kind: "player" }>;

export type DialogueSpeaker = {
  label: string;
  portraitUrl?: string;
  mood?: string;
};

export type DialoguePresentation = {
  id: string;
  kind: "narrator" | "npc" | "player";
  speakerLabel: string;
  text: string;
  portraitUrl?: string;
  mood?: string;
};

export function speakerForNarration(
  line: NarrationLine,
  scene: SceneState,
): DialogueSpeaker {
  if (!line.speakerNpcId) {
    return {
      label: "Erzähler",
      mood: line.mood,
    };
  }

  const activeNpc =
    scene.activeNpc?.id === line.speakerNpcId ? scene.activeNpc : null;
  const presentNpc =
    scene.presentNpcs?.find((npc) => npc.id === line.speakerNpcId) ?? null;

  return {
    label: activeNpc?.name ?? presentNpc?.name ?? "NSC",
    mood: activeNpc?.mood ?? line.mood,
    portraitUrl: activeNpc?.portraitUrl ?? presentNpc?.portraitUrl ?? undefined,
  };
}

export function latestDialoguePresentation(
  chat: ChatLine[],
  scene: SceneState,
): DialoguePresentation | null {
  const line = [...chat]
    .reverse()
    .find((candidate): candidate is NarrationLine | PlayerLine =>
      candidate.kind === "narrate" || candidate.kind === "player",
    );
  if (!line) return null;

  if (line.kind === "player") {
    const character = scene.characters?.find(
      (candidate) => candidate.name === line.displayName,
    );

    return {
      id: line.id,
      kind: "player",
      speakerLabel: line.displayName,
      text: line.text,
      portraitUrl: character?.portraitUrl ?? undefined,
      mood: undefined,
    };
  }

  const speaker = speakerForNarration(line, scene);
  return {
    id: line.id,
    kind: line.speakerNpcId ? "npc" : "narrator",
    speakerLabel: speaker.label,
    text: line.text,
    portraitUrl: speaker.portraitUrl,
    mood: speaker.mood,
  };
}
