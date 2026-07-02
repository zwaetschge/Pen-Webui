import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import {
  PREGEN_ASSETS,
  pregenAssetUrl,
  type PregenAssetKind,
  type PregenAssetSpec,
} from "../src/lib/asset/pregen-catalog";

type Args = {
  dryRun: boolean;
  force: boolean;
  limit: number | null;
  group: "monster" | "npc" | null;
  kind: PregenAssetKind | null;
  slug: string | null;
  quality: "low" | "medium" | "high" | "auto";
};

const IMAGE_MODEL = "gpt-image-2";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  await loadDotEnv(".env");
  await loadDotEnv(".env.local");

  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error(
      "OPENAI_API_KEY is required. Put it in .env or export it before running npm run assets:pregen.",
    );
  }

  const selected = selectAssets(args);
  console.log(
    `Preparing ${selected.length} pregenerated asset(s) with ${IMAGE_MODEL}.`,
  );

  if (args.dryRun) {
    for (const spec of selected) {
      console.log(
        `${spec.kind.padEnd(13)} ${spec.slug.padEnd(22)} ${pregenAssetUrl(spec)}`,
      );
    }
    return;
  }

  const client = new OpenAI({ apiKey });
  let generated = 0;
  let skipped = 0;

  for (const spec of selected) {
    const url = pregenAssetUrl(spec);
    const output = path.join(process.cwd(), "public", url.replace(/^\//, ""));
    await fs.mkdir(path.dirname(output), { recursive: true });

    if (!args.force && (await exists(output))) {
      skipped++;
      console.log(`skip  ${url}`);
      continue;
    }

    console.log(`gen   ${url}`);
    const response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: spec.prompt,
      size: imageSize(spec),
      quality: args.quality,
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(
        `OpenAI image response missing b64_json for ${spec.slug}`,
      );
    }
    await fs.writeFile(output, Buffer.from(b64, "base64"));
    generated++;
  }

  console.log(`Done. Generated ${generated}, skipped ${skipped}.`);
}

function selectAssets(args: Args): PregenAssetSpec[] {
  let assets = PREGEN_ASSETS;
  if (args.group) assets = assets.filter((asset) => asset.group === args.group);
  if (args.kind) assets = assets.filter((asset) => asset.kind === args.kind);
  if (args.slug) assets = assets.filter((asset) => asset.slug === args.slug);
  if (args.limit !== null) assets = assets.slice(0, args.limit);
  return assets;
}

function imageSize(spec: PregenAssetSpec): "1024x1024" | "1024x1536" {
  return spec.kind === "npc_portrait" ? "1024x1536" : "1024x1024";
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    force: false,
    limit: null,
    group: null,
    kind: null,
    slug: null,
    quality: "medium",
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--limit":
        args.limit = Number(next());
        if (!Number.isInteger(args.limit) || args.limit < 1) {
          throw new Error("--limit must be a positive integer");
        }
        break;
      case "--group": {
        const value = next();
        if (value !== "monster" && value !== "npc") {
          throw new Error("--group must be monster or npc");
        }
        args.group = value;
        break;
      }
      case "--kind": {
        const value = next();
        if (
          value !== "monster_token" &&
          value !== "npc_portrait" &&
          value !== "npc_token"
        ) {
          throw new Error(
            "--kind must be monster_token, npc_portrait, or npc_token",
          );
        }
        args.kind = value;
        break;
      }
      case "--slug":
        args.slug = next();
        break;
      case "--quality": {
        const value = next();
        if (
          value !== "low" &&
          value !== "medium" &&
          value !== "high" &&
          value !== "auto"
        ) {
          throw new Error("--quality must be low, medium, high, or auto");
        }
        args.quality = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadDotEnv(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
