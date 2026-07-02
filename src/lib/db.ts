import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

configurePrismaEngine();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function configurePrismaEngine() {
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) return;
  if (process.platform !== "linux") return;

  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const isMusl = !report?.header?.glibcVersionRuntime;
  if (!isMusl) return;

  const engine = join(
    process.cwd(),
    "node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node",
  );

  if (existsSync(engine)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
  }
}
