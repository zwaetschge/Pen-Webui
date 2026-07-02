import { prisma } from "../db";
import type { WorldDigest, PersonaConfig } from "./prompts";

const DIGEST_NPC_LIMIT = 40;

/** Pull the live world digest for a campaign session: location, npcs in play,
 *  active encounter, recent facts. */
export async function buildDigest(
  campaignId: string,
  sessionId?: string,
): Promise<{ persona: PersonaConfig; digest: WorldDigest }> {
  const [campaign, opening, activeEnc, liveScene, revealedNpcs, characters] =
    await Promise.all([
      prisma.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: {
          title: true,
          theme: true,
          tone: true,
          systemPromptOverride: true,
          world: { select: { worldFacts: true, threads: true } },
        },
      }),
      prisma.scene.findFirst({
        where: { campaignId },
        orderBy: { order: "asc" },
        select: { title: true, payload: true },
      }),
      prisma.encounter.findFirst({
        where: { campaignId, status: "active" },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, round: true, initiative: true },
      }),
      sessionId
        ? prisma.eventLog.findFirst({
            where: {
              sessionId,
              type: {
                in: [
                  "scene_set",
                  "session_bootstrap_v11",
                  "session_bootstrap_v10",
                  "session_bootstrap_v9",
                  "session_bootstrap_v8",
                  "session_bootstrap_v7",
                  "session_bootstrap_v6",
                  "session_bootstrap_v5",
                  "session_bootstrap_v4",
                  "session_bootstrap_v3",
                  "session_bootstrap_v2",
                ],
              },
            },
            orderBy: { ts: "desc" },
            select: { payload: true },
          })
        : Promise.resolve(null),
      prisma.nPC.findMany({
        where: { campaignId, visibility: "revealed" },
        orderBy: { updatedAt: "desc" },
        take: DIGEST_NPC_LIMIT,
        select: { id: true, name: true, role: true },
      }),
      prisma.character.findMany({
        where: { campaignId },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, sheet: true },
      }),
    ]);

  const liveScenePayload = asRecord(liveScene?.payload);
  const openingPayload = asRecord(opening?.payload);
  const locationId =
    stringOrNull(liveScenePayload.locationId) ??
    stringOrNull(openingPayload.locationId);
  const locationName = stringOrNull(liveScenePayload.locationName);
  const location = await resolveDigestLocation({
    campaignId,
    locationId,
    locationName,
  });

  const world = campaign.world;
  const worldFacts = Array.isArray(world?.worldFacts)
    ? (world.worldFacts as string[])
    : [];
  const threads = Array.isArray(world?.threads)
    ? (world.threads as string[])
    : [];

  const locationDescription =
    stringOrNull(liveScenePayload.locationDescription) ??
    location?.description ??
    null;
  const summary =
    stringOrNull(liveScenePayload.summary) ??
    stringOrNull(openingPayload.summary);
  const hook =
    stringOrNull(liveScenePayload.hook) ?? stringOrNull(openingPayload.hook);
  const objective = stringOrNull(liveScenePayload.objective) ?? hook;
  const whyHere = stringOrNull(liveScenePayload.whyHere);
  const stakes = stringOrNull(liveScenePayload.stakes) ?? summary;
  const nextActions = stringArray(liveScenePayload.nextActions);

  const digest: WorldDigest = {
    campaignTitle: campaign.title,
    plotProgress: undefined,
    activeThreads: threads,
    recentFacts: worldFacts,
    currentLocation: location
      ? {
          id: location.id,
          name: location.name,
          description: locationDescription,
        }
      : locationName
        ? {
            id: "live-location",
            name: locationName,
            description: locationDescription,
          }
        : undefined,
    currentSituation:
      summary ||
      hook ||
      objective ||
      whyHere ||
      stakes ||
      nextActions.length > 0
        ? {
            sceneTitle:
              stringOrNull(liveScenePayload.sceneTitle) ??
              opening?.title ??
              undefined,
            summary: summary ?? undefined,
            hook: hook ?? undefined,
            objective: objective ?? undefined,
            whyHere: whyHere ?? undefined,
            stakes: stakes ?? undefined,
            nextActions: nextActions.length > 0 ? nextActions : undefined,
          }
        : undefined,
    presentNpcs: revealedNpcs.map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
    })),
    characters: characters.map((c) => {
      const sheet = (c.sheet as Record<string, unknown>) ?? {};
      const cls = sheet["class"] as string | undefined;
      const lvl = sheet["level"] as number | undefined;
      const hpCur = sheet["hpCurrent"] as number | undefined;
      const hpMax = sheet["hpMax"] as number | undefined;
      return {
        id: c.id,
        name: c.name,
        classLevel:
          cls && lvl
            ? `${cls} ${lvl}`
            : cls
              ? cls
              : lvl
                ? `lvl ${lvl}`
                : undefined,
        hp: hpCur != null && hpMax != null ? `${hpCur}/${hpMax}` : undefined,
      };
    }),
    activeEncounter: activeEnc
      ? {
          id: activeEnc.id,
          name: activeEnc.name,
          round: activeEnc.round,
          initiative:
            (activeEnc.initiative as unknown as Array<{
              name: string;
              roll: number;
            }>) ?? [],
        }
      : undefined,
  };

  return {
    persona: {
      theme: campaign.theme,
      tone: campaign.tone,
      override: campaign.systemPromptOverride,
    },
    digest,
  };
}

async function resolveDigestLocation(input: {
  campaignId: string;
  locationId: string | null;
  locationName: string | null;
}) {
  const select = { id: true, name: true, description: true };
  if (input.locationId) {
    const byId = await prisma.location.findFirst({
      where: { id: input.locationId, campaignId: input.campaignId },
      select,
    });
    if (byId) return byId;
  }

  if (input.locationName) {
    const byName = await prisma.location.findFirst({
      where: { campaignId: input.campaignId, name: input.locationName },
      select,
    });
    if (byName) return byName;
  }

  return prisma.location.findFirst({
    where: { campaignId: input.campaignId },
    orderBy: { createdAt: "asc" },
    select,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
