/**
 * Hybrid SRD search: vector (cosine) + trigram (name & content) merged via
 * Reciprocal Rank Fusion.  Fast path for exact-slug / exact-name lookups
 * skips embedding entirely.
 */

import { prisma } from "../db";
import { env } from "../env";
import OpenAI from "openai";

export type SRDHit = {
  id: string;
  type: string;
  name: string;
  slug: string;
  source: string;
  content: string;
  data: unknown;
  score: number;
};

export type SearchOptions = {
  query: string;
  type?: string;
  limit?: number;
  /** When false, skips the OpenAI embedding call and uses pure trigram. */
  semantic?: boolean;
};

const RRF_K = 60;
const RRF_LIMIT = 25;

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new OpenAI({ apiKey, baseURL: env().OPENAI_BASE_URL });
    const r = await client.embeddings.create({
      model: env().OPENAI_MODEL_EMBEDDING,
      input: query.slice(0, 8000),
      encoding_format: "float",
    });
    return r.data[0]?.embedding as number[] | undefined ?? null;
  } catch {
    return null;
  }
}

/** Hybrid search.  Returns up to `limit` ranked hits. */
export async function searchSRD(opts: SearchOptions): Promise<SRDHit[]> {
  const { query, type, limit = 10, semantic = true } = opts;
  const q = query.trim();
  if (!q) return [];

  // ── Fast path: exact slug / exact name match ─────────────────────
  const exact = await prisma.$queryRawUnsafe<SRDHit[]>(
    `
    SELECT id, type::text, name, slug, source, content, data, 1.0::float8 AS score
      FROM "SRDChunk"
     WHERE (slug = $1 OR LOWER(name) = LOWER($1))
       ${type ? `AND type = $2::"SRDType"` : ""}
     LIMIT 3;
    `,
    q,
    ...(type ? [type] : []),
  );
  if (exact.length > 0) return exact.slice(0, limit);

  // ── Lexical (trigram) candidates ─────────────────────────────────
  const lexical = await prisma.$queryRawUnsafe<
    Array<SRDHit & { sim: number }>
  >(
    `
    SELECT id, type::text, name, slug, source, content, data,
           GREATEST(similarity(name, $1), similarity(content, $1)) AS sim,
           0::float8 AS score
      FROM "SRDChunk"
     WHERE (name % $1 OR content % $1)
       ${type ? `AND type = $2::"SRDType"` : ""}
     ORDER BY sim DESC
     LIMIT ${RRF_LIMIT};
    `,
    q,
    ...(type ? [type] : []),
  );

  // ── Vector candidates ────────────────────────────────────────────
  let semanticHits: Array<SRDHit & { dist: number }> = [];
  if (semantic) {
    const emb = await embedQuery(q);
    if (emb) {
      const vec = vectorLiteral(emb);
      semanticHits = await prisma.$queryRawUnsafe<
        Array<SRDHit & { dist: number }>
      >(
        `
        SELECT id, type::text, name, slug, source, content, data,
               (embedding <=> $1::halfvec) AS dist,
               0::float8 AS score
          FROM "SRDChunk"
         WHERE embedding IS NOT NULL
           ${type ? `AND type = $2::"SRDType"` : ""}
         ORDER BY embedding <=> $1::halfvec
         LIMIT ${RRF_LIMIT};
        `,
        vec,
        ...(type ? [type] : []),
      );
    }
  }

  // ── Reciprocal Rank Fusion ───────────────────────────────────────
  const byId = new Map<string, SRDHit & { score: number }>();

  const merge = (list: Array<{ id: string }>, weight = 1) => {
    list.forEach((row, i) => {
      const existing = byId.get(row.id);
      const inc = weight / (RRF_K + i + 1);
      if (existing) existing.score += inc;
      else
        byId.set(row.id, {
          ...(row as unknown as SRDHit),
          score: inc,
        });
    });
  };

  merge(lexical, 1.0);
  merge(semanticHits, 1.4); // mild bias toward semantic for free-text queries

  const ranked = [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

export async function getSRDBySlug(slug: string): Promise<SRDHit | null> {
  const rows = await prisma.$queryRawUnsafe<SRDHit[]>(
    `SELECT id, type::text, name, slug, source, content, data, 1.0::float8 AS score
       FROM "SRDChunk"
      WHERE slug = $1
      LIMIT 1;`,
    slug,
  );
  return rows[0] ?? null;
}

export async function listSRDByType(
  type: string,
  limit = 200,
): Promise<SRDHit[]> {
  return prisma.$queryRawUnsafe<SRDHit[]>(
    `SELECT id, type::text, name, slug, source, content, data, 1.0::float8 AS score
       FROM "SRDChunk"
      WHERE type = $1::"SRDType"
      ORDER BY name ASC
      LIMIT $2;`,
    type,
    limit,
  );
}
