/**
 * Worldbuilding wizard.
 *
 *   1. Host fills a form (theme, tone, party size, target session length,
 *      house rules, optional seed ideas).
 *   2. We call the DM runtime and ask for a JSON blueprint.
 *   3. We persist Campaign, CampaignWorld, NPCs, Locations, Items, Encounters,
 *      and the opening Scene.
 *   4. We queue asset-generation jobs for every NPC portrait, Location
 *      background, Location tactical map (where combat-likely), and Item icon.
 */

import { z } from "zod";
import { prisma } from "../db";
import { WORLDBUILD_PROMPT } from "./prompts";
import { createOrReuseCampaignAsset } from "../asset/library";
import { completeDmJsonObject } from "./llm";
import { worldbuildOutputSchema } from "./worldbuild-output-schema";

export const wizardInputSchema = z.object({
  title: z.string().min(2).max(120),
  theme: z.string().min(2).max(120),
  tone: z.string().max(120).optional(),
  partySize: z.number().int().min(1).max(8).default(4),
  partyLevel: z.number().int().min(1).max(20).default(3),
  sessionLengthHours: z.number().min(1).max(12).default(3),
  houseRules: z.string().max(2000).optional(),
  seedIdeas: z.string().max(4000).optional(),
});

export type WizardInput = z.infer<typeof wizardInputSchema>;

const blueprintSchema = z.object({
  title: z.string(),
  logline: z.string(),
  tone: z.string(),
  styleSuffix: z.string(),
  plot: z.object({
    act1: z.object({ summary: z.string(), beats: z.array(z.string()) }),
    act2: z.object({ summary: z.string(), beats: z.array(z.string()) }),
    act3: z.object({ summary: z.string(), beats: z.array(z.string()) }),
    branchingPoints: z.array(z.string()).default([]),
  }),
  factions: z
    .array(
      z.object({
        name: z.string(),
        agenda: z.string(),
        state: z.string(),
      }),
    )
    .default([]),
  npcs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        personality: z.string().default(""),
        voice: z.string().default(""),
        appearance: z.string().default(""),
        secret: z.string().nullable().default(null),
      }),
    )
    .min(1),
  locations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().default(""),
        ambience: z.string().default(""),
        visualPrompt: z.string().default(""),
        tacticalNotes: z.string().default(""),
      }),
    )
    .min(1),
  items: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().default(""),
        visualPrompt: z.string().default(""),
      }),
    )
    .default([]),
  encounters: z
    .array(
      z.object({
        name: z.string(),
        locationId: z.string(),
        monsters: z
          .array(
            z.object({ srdName: z.string(), count: z.number().int().min(1) }),
          )
          .default([]),
        twist: z.string().default(""),
      }),
    )
    .default([]),
  openingScene: z.object({
    locationId: z.string(),
    summary: z.string(),
    presentNpcIds: z.array(z.string()).default([]),
    hook: z.string(),
    introPlan: z.object({
      establishingShot: z.string(),
      setupBeats: z.array(z.string()).min(3).max(6),
      characterHookStyle: z.string(),
      objective: z.string(),
      stakes: z.string(),
      firstPrompt: z.string(),
    }),
  }),
});

export type Blueprint = z.infer<typeof blueprintSchema>;

/** Ask the model for a campaign blueprint. */
export async function draftBlueprint(
  userId: string,
  input: WizardInput,
): Promise<Blueprint> {
  const userMsg = `Design a campaign for the following brief.

TITLE: ${input.title}
THEME: ${input.theme}
TONE: ${input.tone ?? "(unspecified)"}
PARTY: ${input.partySize} characters at level ${input.partyLevel}
TARGET SESSION LENGTH: ${input.sessionLengthHours}h
HOUSE RULES: ${input.houseRules ?? "(none)"}
SEED IDEAS: ${input.seedIdeas ?? "(none)"}

Output the JSON blueprint per the schema. No markdown.`;

  const parsed = await completeDmJsonObject({
    userId,
    system: WORLDBUILD_PROMPT,
    user: userMsg,
    outputSchema: worldbuildOutputSchema,
    temperature: 0.9,
    maxCompletionTokens: 8000,
  });

  return blueprintSchema.parse(parsed);
}

/** Persist a Blueprint into Campaign + related rows + queue asset jobs. */
export async function commitBlueprint(opts: {
  hostId: string;
  input: WizardInput;
  blueprint: Blueprint;
}): Promise<{ campaignId: string }> {
  const { hostId, input, blueprint: bp } = opts;

  const campaign = await prisma.campaign.create({
    data: {
      hostId,
      title: bp.title || input.title,
      theme: input.theme,
      tone: bp.tone || input.tone,
      styleSuffix: bp.styleSuffix,
      status: "generating",
      world: {
        create: {
          plot: bp.plot as never,
          factions: bp.factions as never,
          worldFacts: [] as never,
          threads: bp.plot.branchingPoints as never,
        },
      },
    },
  });

  // Map blueprint IDs → DB IDs for cross-references.
  const npcIdMap = new Map<string, string>();
  const locIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();

  for (const npc of bp.npcs) {
    const row = await prisma.nPC.create({
      data: {
        campaignId: campaign.id,
        name: npc.name,
        role: npc.role,
        description: [npc.personality, npc.voice, npc.secret ?? ""]
          .filter(Boolean)
          .join(" · "),
        sheet: {
          appearance: npc.appearance,
          secret: npc.secret ?? null,
        } as never,
        visibility: "hidden",
      },
    });
    npcIdMap.set(npc.id, row.id);
  }

  for (const loc of bp.locations) {
    const row = await prisma.location.create({
      data: {
        campaignId: campaign.id,
        name: loc.name,
        description: loc.description,
        ambience: loc.ambience,
        gridConfig: loc.tacticalNotes
          ? ({ type: "square", cellSize: 50 } as never)
          : undefined,
      },
    });
    locIdMap.set(loc.id, row.id);
  }

  for (const it of bp.items) {
    const row = await prisma.item.create({
      data: {
        campaignId: campaign.id,
        name: it.name,
        description: it.description,
        data: {} as never,
      },
    });
    itemIdMap.set(it.id, row.id);
  }

  for (const enc of bp.encounters) {
    await prisma.encounter.create({
      data: {
        campaignId: campaign.id,
        name: enc.name,
        locationId: locIdMap.get(enc.locationId),
        monsters: enc.monsters as never,
        initiative: [] as never,
        status: "prepared",
      },
    });
  }

  // Opening scene
  const openingLoc = locIdMap.get(bp.openingScene.locationId);
  await prisma.scene.create({
    data: {
      campaignId: campaign.id,
      order: 1,
      type: "intro",
      title: "Opening",
      payload: {
        locationId: openingLoc ?? null,
        summary: bp.openingScene.summary,
        hook: bp.openingScene.hook,
        introPlan: bp.openingScene.introPlan,
        presentNpcIds: bp.openingScene.presentNpcIds
          .map((bpId) => npcIdMap.get(bpId))
          .filter(Boolean),
      } as never,
    },
  });

  // Queue asset jobs
  const styleSuffix = bp.styleSuffix.trim();
  const compose = (raw: string) =>
    [raw.trim(), styleSuffix].filter(Boolean).join(" — ");

  for (const npc of bp.npcs) {
    const refId = npcIdMap.get(npc.id);
    if (!refId) continue;
    const prompt = compose(
      `Portrait of ${npc.name}, a ${npc.role}. ${npc.appearance || npc.personality}`,
    );
    const { asset } = await createOrReuseCampaignAsset({
      campaignId: campaign.id,
      kind: "npc_portrait",
      prompt,
      refType: "npc",
      refId,
      name: npc.name,
      role: npc.role,
      description: [npc.appearance, npc.personality].filter(Boolean).join(" "),
    });
    if (!asset) continue;
    await prisma.nPC.update({
      where: { id: refId },
      data: { portraitAssetId: asset.id },
    });

    const token = await createOrReuseCampaignAsset({
      campaignId: campaign.id,
      kind: "npc_token",
      prompt: `Top-down token of ${npc.name}, a ${npc.role}.`,
      refType: "npc",
      refId,
      name: npc.name,
      role: npc.role,
      description: [npc.appearance, npc.personality].filter(Boolean).join(" "),
      allowGeneration: false,
    });
    if (token.asset) {
      await prisma.nPC.update({
        where: { id: refId },
        data: { tokenAssetId: token.asset.id },
      });
    }
  }

  for (const loc of bp.locations) {
    const refId = locIdMap.get(loc.id);
    if (!refId) continue;
    const bgPrompt = compose(
      loc.visualPrompt ||
        `Wide cinematic view of ${loc.name}. ${loc.description}`,
    );
    const { asset: bg } = await createOrReuseCampaignAsset({
      campaignId: campaign.id,
      kind: "location_background",
      prompt: bgPrompt,
      refType: "location",
      refId,
      name: loc.name,
      description: [loc.description, loc.ambience, loc.visualPrompt]
        .filter(Boolean)
        .join(" "),
    });
    if (!bg) continue;
    await prisma.location.update({
      where: { id: refId },
      data: { backgroundAssetId: bg.id },
    });

    if (loc.tacticalNotes && loc.tacticalNotes.length > 0) {
      const mapPrompt = compose(
        `Top-down tactical battle map of ${loc.name}. ${loc.tacticalNotes}. Square grid implied, clean readable layout, terrain features distinguishable from above.`,
      );
      const { asset: map } = await createOrReuseCampaignAsset({
        campaignId: campaign.id,
        kind: "location_tactical_map",
        prompt: mapPrompt,
        refType: "location",
        refId,
        name: loc.name,
        description: [loc.description, loc.ambience, loc.tacticalNotes]
          .filter(Boolean)
          .join(" "),
      });
      if (!map) continue;
      await prisma.location.update({
        where: { id: refId },
        data: { tacticalMapAssetId: map.id },
      });
    }
  }

  for (const it of bp.items) {
    const refId = itemIdMap.get(it.id);
    if (!refId || !it.visualPrompt) continue;
    const prompt = compose(
      `Icon of ${it.name}: ${it.visualPrompt}. Centered on neutral parchment background.`,
    );
    const { asset } = await createOrReuseCampaignAsset({
      campaignId: campaign.id,
      kind: "item_icon",
      prompt,
      refType: "item",
      refId,
      name: it.name,
      description: [it.description, it.visualPrompt].filter(Boolean).join(" "),
    });
    if (!asset) continue;
    await prisma.item.update({
      where: { id: refId },
      data: { iconAssetId: asset.id },
    });
  }

  return { campaignId: campaign.id };
}

/** Promote a generating campaign to ready, called when all assets have a status != pending/generating. */
export async function maybeMarkReady(campaignId: string) {
  const blocking = await prisma.asset.count({
    where: {
      campaignId,
      status: { in: ["pending", "queued", "generating"] },
    },
  });
  if (blocking === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "ready" },
    });
  }
}
