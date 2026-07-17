export type GameplayConsoleMode = "inline" | "drawer" | null;
export type SharedStageView = "map" | "cinematic";
export type SharedStagePresentation = "dialogue" | "cutscene" | null;

export function gameplayConsoleMode(input: {
  experience: "table" | "companion" | "display";
  role: "host" | "player";
}): GameplayConsoleMode {
  if (input.experience === "display") return null;
  if (input.experience === "table") {
    return input.role === "host" ? "drawer" : null;
  }
  return "inline";
}

export function isHostConsoleAvailable(input: {
  mode: GameplayConsoleMode;
  gameOver: boolean;
  sessionEnded: boolean;
}) {
  return input.mode === "drawer" && !input.gameOver && !input.sessionEnded;
}

export function sharedStageView(input: {
  combatActive: boolean;
  presentationMode: SharedStagePresentation;
}): SharedStageView {
  if (input.combatActive) return "map";
  return input.presentationMode ? "cinematic" : "map";
}
