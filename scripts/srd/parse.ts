import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { classify, slugify } from "./classify";
import type { SRDRecord, SRDType } from "./types";

/** Extract a sensible name from a markdown body: first H1, else first non-empty line. */
function extractName(md: string, fallback: string): string {
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const firstLine = md.split("\n").find((l) => l.trim().length > 0);
  return firstLine ? firstLine.replace(/^#+\s*/, "").trim() : fallback;
}

/** Extract structured stats from spell/monster blocks where possible.
 *  Best-effort: parses key/value lines like `**Level:** 3` or `Casting Time: 1 action`. */
function extractKVMeta(md: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = md.split("\n");
  // Inspect the first ~50 lines: stat blocks tend to live near the top.
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const line = lines[i].trim();
    // Match "**Key:** value" or "Key: value" or "_Key:_ value"
    const m =
      line.match(/^\*\*([^:*]+):\*\*\s+(.+)$/) ||
      line.match(/^_([^:_]+):_\s+(.+)$/) ||
      line.match(/^([A-Z][A-Za-z ]{1,30}):\s+(.+)$/);
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      const val = m[2].trim().replace(/\*+/g, "");
      if (!meta[key] && val.length < 200) meta[key] = val;
    }
  }
  return meta;
}

async function* walkMd(root: string, dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkMd(root, full);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      yield full;
    }
  }
}

const SKIP_NAMES = new Set([
  "readme",
  "license",
  "changelog",
  "contributing",
  "code-of-conduct",
  "index",
]);

const TYPE_PRIORITY: Record<SRDType, number> = {
  spell: 9,
  monster: 9,
  item: 7,
  feature: 6,
  feat: 6,
  background: 6,
  race: 6,
  class: 7,
  condition: 7,
  rule: 3,
};

export async function* parseRepo(root: string): AsyncGenerator<SRDRecord> {
  const seen = new Set<string>();
  for await (const file of walkMd(root, root)) {
    const rel = relative(root, file).split(sep).join("/");
    const fileBase = rel.replace(/\.md$/i, "").split("/").pop() ?? "";
    if (SKIP_NAMES.has(fileBase.toLowerCase())) continue;

    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!content.trim()) continue;

    const type = classify(rel);
    const name = extractName(content, fileBase);
    const baseSlug = slugify(name) || slugify(fileBase);
    if (!baseSlug) continue;
    const slug = `${type}/${baseSlug}`;
    if (seen.has(slug)) {
      // Keep the higher-priority type's record; skip the duplicate.
      continue;
    }
    seen.add(slug);

    const data = extractKVMeta(content);
    yield {
      type,
      name,
      slug,
      source: rel,
      content,
      data,
    };
  }
}

export { TYPE_PRIORITY };
