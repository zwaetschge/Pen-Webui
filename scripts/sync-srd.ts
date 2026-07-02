/**
 * SRD sync orchestrator.
 *
 *   1. clone / pull `oldmanumby/dnd.srd.5.1`
 *   2. walk the repo, classify and parse markdown into typed records
 *   3. embed records via OpenAI when OPENAI_API_KEY is available
 *   4. upsert into Postgres (SRDChunk), with null embeddings in lexical-only mode
 *
 * Idempotent: re-running just updates rows that changed.
 *
 *   $ npm run srd:sync
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { parseRepo } from "./srd/parse";
import { embedRecords } from "./srd/embed";

const REPO_URL =
  process.env.SRD_REPO_URL ?? "https://github.com/oldmanumby/dnd.srd.5.1.git";
const CACHE_DIR = process.env.SRD_CACHE_DIR ?? "./.srd-repo";
const BATCH = Number(process.env.SRD_SYNC_BATCH ?? 32);

function sh(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  }
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function main() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`cloning ${REPO_URL} into ${CACHE_DIR}`);
    sh("git", ["clone", "--depth", "1", REPO_URL, CACHE_DIR]);
  } else {
    console.log(`pulling latest in ${CACHE_DIR}`);
    sh("git", ["pull", "--ff-only"], { cwd: CACHE_DIR });
  }

  const prisma = new PrismaClient();
  const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

  if (!openai) {
    console.warn(
      "OPENAI_API_KEY not set; syncing SRD in lexical-only mode without embeddings.",
    );
  }

  let parsed = 0;
  const buffer: Array<{
    type: string;
    name: string;
    slug: string;
    source: string;
    content: string;
    data: Record<string, unknown> | null;
  }> = [];

  console.log("parsing markdown");
  for await (const r of parseRepo(CACHE_DIR)) {
    parsed++;
    buffer.push({
      type: r.type,
      name: r.name,
      slug: r.slug,
      source: r.source,
      content: r.content,
      data: r.data ?? null,
    });
  }
  console.log(`parsed ${parsed} records`);

  console.log("embedding + upserting");
  let processed = 0;
  for (let i = 0; i < buffer.length; i += BATCH) {
    const slice = buffer.slice(i, i + BATCH);
    const embeddings = openai
      ? await embedRecords(
          openai,
          slice.map((s) => ({
            type: s.type as never,
            name: s.name,
            slug: s.slug,
            source: s.source,
            content: s.content,
            data: (s.data ?? undefined) as never,
          })),
        )
      : Array<null>(slice.length).fill(null);

    // Upsert via raw SQL because pgvector column is Unsupported in Prisma.
    for (let j = 0; j < slice.length; j++) {
      const rec = slice[j];
      const emb = embeddings[j];
      const vec = emb ? vectorLiteral(emb) : null;
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "SRDChunk" (id, type, name, slug, source, content, data, embedding, "createdAt", "updatedAt")
        VALUES (
          'srd_' || md5($1),
          $2::"SRDType", $3, $1, $4, $5, $6::jsonb, $7::halfvec, NOW(), NOW()
        )
        ON CONFLICT (slug) DO UPDATE SET
          type = EXCLUDED.type,
          name = EXCLUDED.name,
          source = EXCLUDED.source,
          content = EXCLUDED.content,
          data = EXCLUDED.data,
          embedding = COALESCE(EXCLUDED.embedding, "SRDChunk".embedding),
          "updatedAt" = NOW();
        `,
        rec.slug,
        rec.type,
        rec.name,
        rec.source,
        rec.content,
        JSON.stringify(rec.data ?? {}),
        vec,
      );
      processed++;
    }
    console.log(`  ${processed}/${buffer.length}`);
  }

  // Build / refresh indexes for hybrid search.
  console.log("ensuring indexes");
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS srd_embedding_idx
       ON "SRDChunk" USING hnsw (embedding halfvec_cosine_ops);`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS srd_name_trgm_idx
       ON "SRDChunk" USING gin (name gin_trgm_ops);`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS srd_content_trgm_idx
       ON "SRDChunk" USING gin (content gin_trgm_ops);`,
  );

  await prisma.$disconnect();
  console.log(
    openai
      ? `done. ${processed} records embedded + stored.`
      : `done. ${processed} records stored without embeddings.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
