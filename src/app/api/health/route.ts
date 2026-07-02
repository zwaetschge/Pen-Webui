import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, "ok" | "fail" | "skipped"> = {
    app: "ok",
    db: "skipped",
    redis: "skipped",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "fail";
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "fail";
  } catch {
    checks.redis = "fail";
  }

  const allOk = Object.values(checks).every((v) => v !== "fail");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      version: process.env.npm_package_version ?? "0.1.0",
      ts: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
