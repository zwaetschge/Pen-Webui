/**
 * BullMQ asset-generation worker.
 *
 * Lifecycle per job:
 *   1. mark Asset row `generating`
 *   2. call asset/generate.ts -> PNG buffer + backend name
 *   3. upload to MinIO bucket via asset/s3.ts
 *   4. mark Asset row `ready` with url + dims + backend
 *   5. on terminal failure: mark `failed` with error message
 *
 * Also: bumps Campaign.status from `generating` → `ready` once no
 * pending/queued/generating assets remain.
 */

import { Worker, type Job } from "bullmq";
import type { AssetKind } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { generateAsset } from "../src/lib/asset/generate";
import { recordGeneratedAssetInLibrary } from "../src/lib/asset/library";
import { ensureBucket, uploadAsset } from "../src/lib/asset/s3";
import { targetDims } from "../src/lib/asset/dimensions";
import { maybeMarkReady } from "../src/lib/dm/worldbuild";
import { publishEvent } from "../src/lib/game/bus";
import { bullConnection, type AssetJob } from "../src/lib/asset/queue";
import { resolveOpenAIFallbackConfig } from "../src/lib/openai";

const connection = bullConnection;

async function processJob(job: Job<AssetJob>) {
  const { assetId, prompt, kind, campaignId } = job.data;
  logger.info({ jobId: job.id, assetId, kind }, "asset job picked up");

  const claimed = await prisma.asset.updateMany({
    where: {
      id: assetId,
      campaignId,
    },
    data: { status: "generating", jobId: job.id ?? null },
  });
  if (claimed.count === 0) {
    logger.info(
      { jobId: job.id, assetId, campaignId },
      "asset job skipped because asset is gone or campaign changed",
    );
    return;
  }

  try {
    const openai = await resolveCampaignOpenAIConfig(campaignId);
    const { png, backend } = await generateAsset({
      prompt,
      kind,
      openai,
    });
    const key = `campaigns/${campaignId ?? "anon"}/${kind}/${assetId}-${generationVersion(job)}.png`;
    const url = await uploadAsset(key, png);
    const dims = pngDimensions(png) ?? targetDims(kind);

    const updated = await prisma.asset.updateMany({
      where: {
        id: assetId,
        campaignId,
      },
      data: {
        status: "ready",
        url,
        s3Key: key,
        backend,
        width: dims.width,
        height: dims.height,
        generatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      logger.info(
        { jobId: job.id, assetId, campaignId },
        "asset result discarded because asset is gone or campaign changed",
      );
      return;
    }
    logger.info({ assetId, url, backend }, "asset ready");

    if (campaignId) {
      const asset = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { meta: true },
      });
      const meta = (asset?.meta as Record<string, unknown> | null) ?? {};

      await recordGeneratedAssetInLibrary({
        sourceAssetId: assetId,
        sourceCampaignId: campaignId,
        kind: kind as AssetKind,
        prompt,
        backend,
        s3Key: key,
        url,
        width: dims.width,
        height: dims.height,
        sourceMeta: meta,
      }).catch((e) =>
        logger.warn(
          { assetId, err: (e as Error).message },
          "failed to record generated asset in library",
        ),
      );

      const activeSession = await prisma.gameSession.findFirst({
        where: { campaignId, endedAt: null },
        select: { id: true },
      });
      if (activeSession) {
        await publishEvent(activeSession.id, "asset_ready", {
          assetId,
          url,
          kind,
          refType: meta.refType ?? null,
          refId: meta.refId ?? null,
        });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.asset
      .updateMany({
        where: {
          id: assetId,
          campaignId,
        },
        data: { status: "failed", errorMsg: msg.slice(0, 1000) },
      })
      .catch(() => undefined);
    logger.error({ assetId, err: msg }, "asset generation failed");
    if (campaignId) await maybeMarkReady(campaignId).catch(() => {});
    throw e;
  }

  if (campaignId) await maybeMarkReady(campaignId).catch(() => {});
}

async function resolveCampaignOpenAIConfig(campaignId: string | null) {
  if (!campaignId) return undefined;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { hostId: true },
  });
  if (!campaign) return undefined;

  try {
    const config = await resolveOpenAIFallbackConfig(campaign.hostId);
    return { apiKey: config.apiKey, baseURL: config.baseURL };
  } catch (e) {
    logger.debug(
      { campaignId, err: (e as Error).message },
      "no campaign OpenAI image config available",
    );
    return undefined;
  }
}

function pngDimensions(png: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) {
    return null;
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function generationVersion(job: Job<AssetJob>): string {
  const jobId = String(job.id ?? "job").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${Date.now()}-${jobId}`;
}

async function bootstrap() {
  await ensureBucket().catch((e) =>
    logger.warn(
      { err: (e as Error).message },
      "ensureBucket failed (continuing)",
    ),
  );

  const worker = new Worker<AssetJob>("assets", processJob, {
    connection,
    concurrency: Number(process.env.ASSET_CONCURRENCY ?? 2),
  });

  worker.on("ready", () => logger.info("asset worker ready"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err: err.message }, "job failed"),
  );

  const shutdown = async () => {
    logger.info("shutting down asset worker");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((e) => {
  logger.error({ err: (e as Error).message }, "worker bootstrap failed");
  process.exit(1);
});
