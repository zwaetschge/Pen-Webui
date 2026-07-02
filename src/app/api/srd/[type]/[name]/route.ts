import { NextResponse } from "next/server";
import { getSRDBySlug } from "@/lib/srd/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; name: string }> },
) {
  const { type, name } = await params;
  const slug = `${type}/${name}`;
  const hit = await getSRDBySlug(slug);
  if (!hit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(hit);
}
