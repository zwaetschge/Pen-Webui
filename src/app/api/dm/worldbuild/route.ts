import { NextResponse } from "next/server";
import { requireDM, AuthError } from "@/lib/auth";
import { prepareMarkdownLoreFile } from "@/lib/dm/lore/markdown";
import { researchPublicLore } from "@/lib/dm/lore/research";
import { defaultLoreResearchProviders } from "@/lib/dm/lore/research-providers";
import { buildLoreBible, summarizePreparedSources } from "@/lib/dm/lore/summarize";
import { loreOptionsSchema } from "@/lib/dm/lore/types";
import {
  wizardInputSchema,
  draftBlueprint,
  commitBlueprint,
} from "@/lib/dm/worldbuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_TOTAL_LORE_UPLOAD_BYTES = 8 * 1024 * 1024;

async function parseWorldbuildRequest(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const body = (await req.json()) as { lore?: unknown };
    return {
      input: wizardInputSchema.parse(body),
      loreOptions: loreOptionsSchema.parse(body.lore ?? {}),
      loreFiles: [] as File[],
    };
  }

  const form = await req.formData();
  const briefRaw = form.get("brief");
  if (typeof briefRaw !== "string") {
    throw new Error("missing brief");
  }

  const parsed = JSON.parse(briefRaw) as { lore?: unknown };
  const loreFiles = [...form.getAll("loreFiles"), ...form.getAll("loreFiles[]")]
    .filter((value): value is File => value instanceof File);
  const totalUploadBytes = loreFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalUploadBytes > MAX_TOTAL_LORE_UPLOAD_BYTES) {
    throw new Error("Lore uploads exceed the total 8 MB limit");
  }

  return {
    input: wizardInputSchema.parse(parsed),
    loreOptions: loreOptionsSchema.parse(parsed.lore ?? {}),
    loreFiles,
  };
}

export async function POST(req: Request) {
  try {
    const user = await requireDM();
    const { input, loreOptions, loreFiles } = await parseWorldbuildRequest(req);

    const uploadedSources = await Promise.all(
      loreFiles.map((file) => prepareMarkdownLoreFile(file)),
    );
    const research = await researchPublicLore(
      {
        theme: input.theme,
        maxResults: 6,
        enabled: loreOptions.researchPublicLore,
      },
      defaultLoreResearchProviders(user.id),
    );
    const loreSources = await summarizePreparedSources(user.id, {
      theme: input.theme,
      sourceNotes: loreOptions.sourceNotes,
      uploadedSources,
      researchHits: research.results,
    });
    const loreBible = await buildLoreBible(user.id, {
      theme: input.theme,
      sourceNotes: loreOptions.sourceNotes,
      uploadedSources: loreSources,
      researchHits: [],
    });

    const blueprint = await draftBlueprint(user.id, input, { loreBible });
    const { campaignId } = await commitBlueprint({
      hostId: user.id,
      input,
      blueprint,
      loreBible,
      loreSources,
    });

    return NextResponse.json({
      campaignId,
      blueprint,
        lore: {
          sourceCount: loreSources.length,
          researchProvider: research.provider ?? null,
          warnings: research.warnings,
        },
      });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
