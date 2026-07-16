import { z } from "zod";

type UpdateFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const codexUpdateStatusSchema = z.object({
  available: z.boolean(),
  currentVersion: z.string().nullable(),
  source: z.enum(["configured", "managed", "bundled", "workspace", "path"]),
  managed: z.boolean(),
  canUpdate: z.boolean(),
  updating: z.boolean(),
});

const statusResponseSchema = z.object({
  ok: z.literal(true),
  status: codexUpdateStatusSchema,
});

const updateResultSchema = z.object({
  previousVersion: z.string().nullable(),
  currentVersion: z.string(),
  changed: z.boolean(),
  status: codexUpdateStatusSchema,
});

const updateResponseSchema = z.object({
  ok: z.literal(true),
  result: updateResultSchema,
});

export type CodexUpdateStatus = z.infer<typeof codexUpdateStatusSchema>;
export type CodexUpdateResult = z.infer<typeof updateResultSchema>;

export async function fetchCodexUpdateStatus(
  fetcher: UpdateFetcher = fetch,
): Promise<CodexUpdateStatus> {
  const body = await updateRequest(
    { cache: "no-store" },
    statusResponseSchema,
    fetcher,
  );
  return body.status;
}

export async function requestCodexUpdate(
  fetcher: UpdateFetcher = fetch,
): Promise<CodexUpdateResult> {
  const body = await updateRequest(
    { method: "POST" },
    updateResponseSchema,
    fetcher,
  );
  return body.result;
}

async function updateRequest<T>(
  init: RequestInit,
  schema: z.ZodType<T>,
  fetcher: UpdateFetcher,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher("/api/dm/codex/update", init);
  } catch (cause) {
    throw new Error("Der Codex-Updater ist nicht erreichbar.", { cause });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error("The Codex updater returned an invalid response.", {
      cause,
    });
  }

  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({ message: z.string() }),
      })
      .safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : `Codex update failed (${response.status}).`,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error("The Codex updater returned an invalid response.");
  }
  return parsed.data;
}
