import type { SRDHit } from "./search";

/** Compact, model-friendly rendering of an SRD hit for tool returns. */
export function formatForTool(hit: SRDHit): string {
  const data = (hit.data ?? {}) as Record<string, unknown>;
  const metaLines = Object.entries(data)
    .slice(0, 10)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join("\n");
  const body = hit.content.slice(0, 4000);
  return `# ${hit.name}  _(${hit.type})_\n\n${metaLines ? metaLines + "\n\n" : ""}${body}`;
}

/** Truncated snippet for search-result lists. */
export function snippet(hit: SRDHit, maxLen = 220): string {
  const stripped = hit.content
    .replace(/^#.*$/gm, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxLen
    ? stripped.slice(0, maxLen).trimEnd() + "…"
    : stripped;
}
