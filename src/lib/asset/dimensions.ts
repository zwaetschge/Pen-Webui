import type { AssetKind } from "@prisma/client";

/** Target dimensions and orientation per asset kind. */
export function targetDims(kind: AssetKind | string): {
  width: number;
  height: number;
  aspect: "portrait" | "landscape" | "square";
} {
  switch (kind) {
    case "npc_portrait":
    case "character_portrait":
      return { width: 768, height: 1024, aspect: "portrait" };
    case "npc_token":
    case "character_token":
      return { width: 512, height: 512, aspect: "square" };
    case "location_background":
    case "scene_keyframe":
      return { width: 1536, height: 864, aspect: "landscape" };
    case "location_tactical_map":
      return { width: 1280, height: 1280, aspect: "square" };
    case "item_icon":
      return { width: 512, height: 512, aspect: "square" };
    default:
      return { width: 1024, height: 1024, aspect: "square" };
  }
}

/** OpenAI image models accept only specific sizes; map to closest. */
export function openaiSize(
  kind: AssetKind | string,
): "1024x1024" | "1024x1536" | "1536x1024" {
  const d = targetDims(kind);
  if (d.aspect === "portrait") return "1024x1536";
  if (d.aspect === "landscape") return "1536x1024";
  return "1024x1024";
}
