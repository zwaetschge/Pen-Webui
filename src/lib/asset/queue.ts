import { Queue, type JobsOptions } from "bullmq";
import type { JobType } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
  };
}

export const bullConnection = parseRedisUrl(REDIS_URL);

export type AssetJob = {
  assetId: string;
  prompt: string;
  kind: string;
  campaignId: string | null;
};

let queue: Queue<AssetJob, unknown, "generate"> | null = null;

function getQueue() {
  if (!queue) {
    queue = new Queue<AssetJob, unknown, "generate">("assets", {
      connection: bullConnection,
    });
  }
  return queue;
}

export async function queueAssetJob(job: AssetJob, opts: JobsOptions = {}) {
  return getQueue().add("generate", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 4000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    ...opts,
  });
}

export async function removeQueuedAssetJobsForCampaign(campaignId: string) {
  const removableStates: JobType[] = [
    "waiting",
    "delayed",
    "prioritized",
    "paused",
  ];
  const jobs = await getQueue().getJobs(removableStates, 0, -1, false);

  const results: number[] = await Promise.all(
    jobs.map(async (job) => {
      if ((job.data as AssetJob | undefined)?.campaignId !== campaignId)
        return 0;
      try {
        await job.remove();
        return 1;
      } catch {
        return 0;
      }
    }),
  );

  return results.reduce((sum, count) => sum + count, 0);
}

export function assetQueue() {
  return getQueue();
}
