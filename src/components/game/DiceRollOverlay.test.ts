import { describe, expect, it } from "vitest";
import { renderDiceCanvas } from "./DiceRollOverlay";

describe("renderDiceCanvas", () => {
  it("returns null instead of throwing when WebGL is unavailable", () => {
    const canvas = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    expect(renderDiceCanvas(canvas, [{ sides: 20, value: 13 }], false)).toBeNull();
  });
});
