import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { searchSRD } from "@/lib/srd/search";
import { snippet } from "@/lib/srd/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(200),
  type: z
    .enum([
      "spell",
      "monster",
      "rule",
      "item",
      "class",
      "race",
      "background",
      "feat",
      "condition",
      "feature",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  semantic: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    q: sp.get("q") ?? "",
    type: sp.get("type") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    semantic: sp.get("semantic") !== "0",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const { q, type, limit, semantic } = parsed.data;

  if (!q) {
    return NextResponse.json({ hits: [] });
  }

  const hits = await searchSRD({ query: q, type, limit, semantic });
  return NextResponse.json({
    query: q,
    type,
    hits: hits.map((h) => ({
      id: h.id,
      type: h.type,
      name: h.name,
      slug: h.slug,
      snippet: snippet(h),
      score: h.score,
    })),
  });
}
