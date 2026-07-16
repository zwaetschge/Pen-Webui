export type GameplayConsoleMode = "inline" | "drawer" | null;

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
