const STYLE_STOPWORDS = new Set([
  "asset",
  "background",
  "brass",
  "centered",
  "cinematic",
  "clean",
  "dark",
  "dramatic",
  "fantasy",
  "grain",
  "grid",
  "icon",
  "illustration",
  "image",
  "light",
  "map",
  "neutral",
  "painted",
  "painterly",
  "palette",
  "parchment",
  "portrait",
  "readable",
  "scene",
  "square",
  "style",
  "tactical",
  "token",
  "top",
  "view",
  "visual",
  "wide",
]);

const COMMON_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function assetMatchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 2 &&
        !COMMON_STOPWORDS.has(token) &&
        !STYLE_STOPWORDS.has(token),
    );
}

export function scoreAssetTextMatch(query: string, candidate: string): number {
  const queryTokens = new Set(assetMatchTokens(query));
  const candidateTokens = new Set(assetMatchTokens(candidate));
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap++;
  }
  if (overlap === 0) return 0;

  const precision = overlap / candidateTokens.size;
  const recall = overlap / queryTokens.size;
  return (precision + recall) / 2;
}

export function isAssetTextMatch(
  query: string,
  candidate: string,
  threshold = 0.22,
): boolean {
  return scoreAssetTextMatch(query, candidate) >= threshold;
}
