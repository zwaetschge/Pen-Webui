import type { Asset, AssetKind } from "@prisma/client";
import { prisma } from "../db";
import { targetDims } from "./dimensions";
import { scoreAssetTextMatch } from "./match";
import { resolvePregeneratedAsset } from "./pregenerated";
import type { PregenAssetKind } from "./pregen-catalog";
import { queueAssetJob } from "./queue";

type AssetMeta = Record<string, unknown>;

type CampaignAssetInput = {
  campaignId: string;
  kind: AssetKind;
  prompt: string;
  negativePrompt?: string | null;
  allowGeneration?: boolean;
  refType?: string;
  refId?: string;
  name?: string | null;
  role?: string | null;
  description?: string | null;
};

export type CampaignAssetResult = {
  asset: Asset | null;
  queued: boolean;
  source: "library" | "pregenerated" | "generation" | "none";
};

export async function createOrReuseCampaignAsset(
  input: CampaignAssetInput,
): Promise<CampaignAssetResult> {
  const libraryAsset = await findReusableLibraryAsset(input);
  if (libraryAsset) {
    return {
      asset: await createCampaignAssetFromLibrary(input, libraryAsset),
      queued: false,
      source: "library",
    };
  }

  const pregen = await findReusablePregenAsset(input);
  if (pregen) {
    const dims = targetDims(input.kind);
    return {
      asset: await prisma.asset.create({
        data: {
          campaignId: input.campaignId,
          kind: input.kind,
          status: "ready",
          prompt: input.prompt,
          negativePrompt: input.negativePrompt ?? null,
          backend: "pregenerated",
          s3Key: pregen.url,
          url: pregen.url,
          width: dims.width,
          height: dims.height,
          generatedAt: new Date(),
          meta: {
            ...baseMeta(input),
            librarySource: "pregenerated",
            pregenSlug: pregen.spec.slug,
            pregenLabel: pregen.spec.label,
          } as never,
        },
      }),
      queued: false,
      source: "pregenerated",
    };
  }

  if (input.allowGeneration === false) {
    return { asset: null, queued: false, source: "none" };
  }

  const asset = await prisma.asset.create({
    data: {
      campaignId: input.campaignId,
      kind: input.kind,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      status: "pending",
      meta: baseMeta(input) as never,
    },
  });
  await queueAssetJob({
    assetId: asset.id,
    prompt: input.prompt,
    kind: input.kind,
    campaignId: input.campaignId,
  });
  return { asset, queued: true, source: "generation" };
}

export async function recordGeneratedAssetInLibrary(opts: {
  sourceAssetId: string;
  sourceCampaignId: string;
  kind: AssetKind;
  prompt: string;
  negativePrompt?: string | null;
  backend: "codex-cli" | "openai";
  s3Key: string;
  url: string;
  width: number;
  height: number;
  sourceMeta?: Record<string, unknown> | null;
}): Promise<Asset> {
  const sourceMeta = objectMeta(opts.sourceMeta);
  return prisma.asset.create({
    data: {
      campaignId: null,
      kind: opts.kind,
      status: "ready",
      prompt: opts.prompt,
      negativePrompt: opts.negativePrompt ?? null,
      backend: opts.backend,
      s3Key: opts.s3Key,
      url: opts.url,
      width: opts.width,
      height: opts.height,
      generatedAt: new Date(),
      meta: {
        library: true,
        librarySource: "generated",
        sourceAssetId: opts.sourceAssetId,
        sourceCampaignId: opts.sourceCampaignId,
        searchName:
          typeof sourceMeta.searchName === "string"
            ? sourceMeta.searchName
            : null,
        searchRole:
          typeof sourceMeta.searchRole === "string"
            ? sourceMeta.searchRole
            : null,
      } as never,
    },
  });
}

async function createCampaignAssetFromLibrary(
  input: CampaignAssetInput,
  source: Asset,
): Promise<Asset> {
  return prisma.asset.create({
    data: {
      campaignId: input.campaignId,
      kind: input.kind,
      status: "ready",
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      backend: source.backend ?? "library",
      s3Key: source.s3Key,
      url: source.url,
      width: source.width,
      height: source.height,
      generatedAt: new Date(),
      meta: {
        ...baseMeta(input),
        libraryAssetId: source.id,
        librarySource: "generated",
        libraryBackend: source.backend ?? null,
        libraryPrompt: source.prompt,
      } as never,
    },
  });
}

async function findReusableLibraryAsset(
  input: CampaignAssetInput,
): Promise<Asset | null> {
  const used = await usedCampaignAssetSources(input.campaignId, input.kind);
  const candidates = await prisma.asset.findMany({
    where: {
      campaignId: null,
      kind: input.kind,
      status: "ready",
      url: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const query = searchText(input);
  let best: { asset: Asset; score: number } | null = null;
  for (const asset of candidates) {
    if (used.libraryAssetIds.has(asset.id)) continue;
    if (asset.url && used.urls.has(asset.url)) continue;
    if (asset.backend !== "codex-cli" && asset.backend !== "openai") continue;

    const score = scoreAssetTextMatch(query, sourceSearchText(asset));
    if (
      score >= libraryMatchThreshold(input.kind) &&
      (!best || score > best.score)
    ) {
      best = { asset, score };
    }
  }

  return best?.asset ?? null;
}

async function findReusablePregenAsset(input: CampaignAssetInput) {
  const kind = pregenKind(input.kind);
  if (!kind) return null;
  const used = await usedCampaignAssetSources(input.campaignId, input.kind);
  return resolvePregeneratedAsset({
    kind,
    name: input.name,
    role: input.role,
    description: input.description ?? input.prompt,
    excludeSlugs: [...used.pregenSlugs],
  });
}

async function usedCampaignAssetSources(campaignId: string, kind: AssetKind) {
  const assets = await prisma.asset.findMany({
    where: { campaignId, kind },
    select: { url: true, meta: true },
  });
  const libraryAssetIds = new Set<string>();
  const pregenSlugs = new Set<string>();
  const urls = new Set<string>();

  for (const asset of assets) {
    if (asset.url) urls.add(asset.url);
    const meta = objectMeta(asset.meta);
    if (typeof meta.libraryAssetId === "string") {
      libraryAssetIds.add(meta.libraryAssetId);
    }
    if (typeof meta.pregenSlug === "string") {
      pregenSlugs.add(meta.pregenSlug);
    }
  }

  return { libraryAssetIds, pregenSlugs, urls };
}

function pregenKind(kind: AssetKind): PregenAssetKind | null {
  if (kind === "npc_portrait" || kind === "npc_token") return kind;
  return null;
}

function libraryMatchThreshold(kind: AssetKind): number {
  if (kind === "npc_portrait" || kind === "npc_token") return 0.34;
  if (kind === "item_icon") return 0.3;
  return 0.26;
}

function baseMeta(input: CampaignAssetInput): AssetMeta {
  return {
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    searchName: input.name ?? null,
    searchRole: input.role ?? null,
  };
}

function searchText(input: CampaignAssetInput): string {
  return [input.name, input.role, input.description, input.prompt]
    .filter(Boolean)
    .join(" ");
}

function sourceSearchText(asset: Asset): string {
  const meta = objectMeta(asset.meta);
  return [meta.searchName, meta.searchRole, meta.libraryPrompt, asset.prompt]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function objectMeta(value: unknown): AssetMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AssetMeta;
}
