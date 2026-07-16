import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { z } from "zod";
import { resolveCodexExecutable } from "./codex-cli";
import {
  CODEX_REASONING_EFFORTS,
  type CodexReasoningEffort,
} from "./codex-settings";

const MODEL_CATALOG_TIMEOUT_MS = 10_000;
const MODEL_CATALOG_TTL_MS = 5 * 60_000;
const MAX_STDERR_CHARS = 8_000;

const rawReasoningEffortSchema = z.object({
  reasoningEffort: z.string(),
  description: z.string().default(""),
});

const rawModelSchema = z.object({
  model: z.string().min(1).max(120),
  displayName: z.string().default(""),
  description: z.string().default(""),
  hidden: z.boolean().default(false),
  supportedReasoningEfforts: z.array(rawReasoningEffortSchema).default([]),
  defaultReasoningEffort: z.string().optional(),
  isDefault: z.boolean().default(false),
});

const modelListPageSchema = z.object({
  data: z.array(z.unknown()),
  nextCursor: z.string().nullable().default(null),
});

export type CodexModelOption = {
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort: CodexReasoningEffort | null;
};

export type CodexModelCatalog = {
  available: boolean;
  models: CodexModelOption[];
  detail: string;
};

let cachedCatalog:
  | { expiresAt: number; value: Promise<CodexModelCatalog> }
  | undefined;

/**
 * Return the same non-hidden, account-aware model catalog used by Codex `/model`.
 * Codex owns the catalog, so a CLI update automatically updates this picker too.
 */
export function codexModelCatalog(options?: {
  forceRefresh?: boolean;
}): Promise<CodexModelCatalog> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedCatalog &&
    cachedCatalog.expiresAt > now
  ) {
    return cachedCatalog.value;
  }

  const value = loadCodexModelCatalog().catch((error: unknown) => ({
    available: false,
    models: [],
    detail:
      error instanceof Error
        ? error.message
        : "Codex model catalog is unavailable.",
  }));
  cachedCatalog = { expiresAt: now + MODEL_CATALOG_TTL_MS, value };
  void value.then((catalog) => {
    if (!catalog.available && cachedCatalog?.value === value) {
      cachedCatalog.expiresAt = Date.now() + 10_000;
    }
  });
  return value;
}

export function invalidateCodexModelCatalog() {
  cachedCatalog = undefined;
}

export function parseCodexModelPages(pages: unknown[]): CodexModelOption[] {
  const models: CodexModelOption[] = [];
  const seen = new Set<string>();

  for (const pageInput of pages) {
    const page = modelListPageSchema.parse(pageInput);
    for (const item of page.data) {
      const parsed = rawModelSchema.safeParse(item);
      if (!parsed.success || parsed.data.hidden) continue;

      const model = normalizeCodexModelId(parsed.data.model);
      if (!model || seen.has(model)) continue;
      seen.add(model);

      const supportedReasoningEfforts = parsed.data.supportedReasoningEfforts
        .map((option) => {
          const reasoningEffort = supportedEffort(option.reasoningEffort);
          return reasoningEffort
            ? {
                reasoningEffort,
                description: option.description,
              }
            : null;
        })
        .filter(
          (
            option,
          ): option is {
            reasoningEffort: CodexReasoningEffort;
            description: string;
          } => option !== null,
        );

      models.push({
        model,
        displayName: parsed.data.displayName.trim() || model,
        description: parsed.data.description.trim(),
        isDefault: parsed.data.isDefault,
        supportedReasoningEfforts,
        defaultReasoningEffort: supportedEffort(
          parsed.data.defaultReasoningEffort,
        ),
      });
    }
  }

  return models;
}

export function validateCodexModelSelection(
  value: string | null | undefined,
  catalog: CodexModelCatalog,
) {
  const model = normalizeCodexModelId(value);
  if (!model) return null;

  if (
    catalog.available &&
    catalog.models.length > 0 &&
    !catalog.models.some((option) => option.model === model)
  ) {
    throw new Error("This model is not available in the Codex model picker.");
  }
  return model;
}

export function validateCodexReasoningEffortSelection(
  model: string,
  effort: CodexReasoningEffort | null,
  catalog: CodexModelCatalog,
) {
  if (!effort || !catalog.available) return effort;

  const option =
    catalog.models.find((item) => item.model === model) ??
    catalog.models.find((item) => item.isDefault) ??
    catalog.models[0];
  if (!option || option.supportedReasoningEfforts.length === 0) return effort;
  if (
    option.supportedReasoningEfforts.some(
      (supported) => supported.reasoningEffort === effort,
    )
  ) {
    return effort;
  }

  const supported = option.supportedReasoningEfforts
    .map((item) => item.reasoningEffort)
    .join(", ");
  throw new Error(
    `${option.displayName} does not support reasoning effort "${effort}". Choose ${supported}.`,
  );
}

function normalizeCodexModelId(value: string | null | undefined) {
  const model = value?.trim();
  if (!model || ["auto", "default"].includes(model.toLowerCase())) return null;
  if (model.length > 120) throw new Error("Codex model name is too long");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) {
    throw new Error("Codex model name contains unsupported characters");
  }
  return model;
}

function supportedEffort(value: string | null | undefined) {
  return CODEX_REASONING_EFFORTS.find((effort) => effort === value) ?? null;
}

async function loadCodexModelCatalog(): Promise<CodexModelCatalog> {
  const pages = await requestCodexModelPages();
  const models = parseCodexModelPages(pages);
  if (models.length === 0) {
    throw new Error("Codex returned an empty model catalog.");
  }
  return {
    available: true,
    models,
    detail: "Models reported by this Codex CLI installation.",
  };
}

function requestCodexModelPages(): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveCodexExecutable().command,
      ["app-server", "--listen", "stdio://"],
      {
        env: codexEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdout });
    const pages: unknown[] = [];
    let stderr = "";
    let requestId = 1;
    let settled = false;

    const timer = setTimeout(() => {
      finish(new Error("Timed out while asking Codex for its model catalog."));
    }, MODEL_CATALOG_TIMEOUT_MS);
    timer.unref();

    const send = (message: unknown) => {
      if (settled || !child.stdin.writable) return;
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error("Codex pipe failed."),
        );
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(pages);
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
    });
    child.stdin.on("error", (error) => {
      if (!settled) finish(error);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (settled) return;
      const suffix = stderr.trim() ? `: ${lastLine(stderr)}` : "";
      finish(
        new Error(`Codex model catalog exited with code ${code}${suffix}`),
      );
    });

    lines.on("line", (line) => {
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }

      if (message.id === 0) {
        if (message.error) {
          finish(
            new Error(
              message.error.message ||
                "Codex app-server initialization failed.",
            ),
          );
          return;
        }
        send({ method: "initialized", params: {} });
        sendModelList();
        return;
      }

      if (message.id !== requestId) return;
      if (message.error) {
        finish(
          new Error(message.error.message || "Codex model lookup failed."),
        );
        return;
      }

      const page = modelListPageSchema.safeParse(message.result);
      if (!page.success) {
        finish(new Error("Codex returned an invalid model catalog."));
        return;
      }
      pages.push(page.data);
      if (page.data.nextCursor) {
        requestId += 1;
        sendModelList(page.data.nextCursor);
      } else {
        finish();
      }
    });

    const sendModelList = (cursor?: string) => {
      send({
        method: "model/list",
        id: requestId,
        params: {
          cursor: cursor ?? null,
          limit: 100,
          includeHidden: false,
        },
      });
    };

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "plum_tabletop",
          title: "Plum Tabletop",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function codexEnv() {
  const localBin = path.join(process.cwd(), "node_modules/.bin");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: ["/app/node_modules/.bin", localBin, process.env.PATH]
      .filter(Boolean)
      .join(":"),
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1",
  };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.OPENAI_BASE_URL;
  return childEnv;
}

function lastLine(value: string) {
  return value.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300);
}
