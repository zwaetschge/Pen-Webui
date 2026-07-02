import type { SRDType } from "./types";

/**
 * Infer SRD record type from a repo-relative path.  The oldmanumby/dnd.srd.5.1
 * repo organises content by top-level directories whose names broadly match
 * SRD section headings.  The mapping below is intentionally permissive so
 * the same parser works against forks with slightly different layouts.
 */
function segments(relPath: string) {
  return relPath
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .map((segment) =>
      segment
        .replace(/^\d+[_\s-]*/, "")
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

export function classify(relPath: string): SRDType {
  const parts = segments(relPath);
  const has = (...names: string[]) =>
    parts.some((part) =>
      names.some((name) => part === name || part.startsWith(`${name} `)),
    );

  if (has("spell", "spells", "spellcasting", "magic spells")) return "spell";
  if (has("monster", "monsters", "bestiary", "creature", "creatures", "stat blocks")) {
    return "monster";
  }
  if (has("class", "classes")) return "class";
  if (has("race", "races")) return "race";
  if (has("background", "backgrounds")) return "background";
  if (has("feat", "feats")) return "feat";
  if (has("condition", "conditions")) return "condition";
  if (has("class features", "feature", "features")) return "feature";
  if (has("magic items", "equipment", "item", "items", "gear", "treasure")) {
    return "item";
  }
  if (has("rules", "combat", "adventuring", "gameplay", "gamemastering", "appendix")) {
    return "rule";
  }
  return "rule";
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}
