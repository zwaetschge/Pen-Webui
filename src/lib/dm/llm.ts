import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { z } from "zod";
import { env } from "../env";
import { logger } from "../logger";
import { resolveOpenAIFallbackConfig } from "../openai";
import { buildCodexExecArgs } from "./codex-args";
import { codexDmSettings, type CodexDmSettings } from "./codex-settings";

const MAX_PROCESS_OUTPUT_CHARS = 512_000;

const codexChatSchema = z.object({
  content: z.string().default(""),
  tool_calls: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        arguments: z.union([z.record(z.unknown()), z.string()]).default({}),
      }),
    )
    .default([]),
});

type CompleteChatOptions = {
  userId: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  temperature?: number;
  maxCompletionTokens?: number;
};

type CompleteJsonOptions = {
  userId: string;
  system: string;
  user: string;
  outputSchema?: Record<string, unknown>;
  temperature?: number;
  maxCompletionTokens?: number;
};

export type LlmChatResult = {
  provider: "codex-cli" | "openai-api";
  model: string;
  content: string;
  toolCalls: ChatCompletionMessageToolCall[];
  tokensUsed: number;
};

export async function completeDmChat(
  opts: CompleteChatOptions,
): Promise<LlmChatResult> {
  return withApiFallback(
    () => completeCodexChat(opts),
    () => completeOpenAIChat(opts),
  );
}

export async function completeDmJsonObject(
  opts: CompleteJsonOptions,
): Promise<unknown> {
  const result = await withApiFallback(
    () => completeCodexJsonObject(opts),
    () => completeOpenAIJsonObject(opts),
  );
  return result.value;
}

export async function codexLoginStatus(): Promise<{
  available: boolean;
  authenticated: boolean;
  detail: string;
}> {
  try {
    const result = await runProcess(
      codexCommand(),
      ["login", "status"],
      "",
      10_000,
    );
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      available: true,
      authenticated: result.code === 0 && /logged in/i.test(detail),
      detail: detail || (result.code === 0 ? "Logged in" : "Not logged in"),
    };
  } catch (e) {
    return {
      available: false,
      authenticated: false,
      detail: e instanceof Error ? e.message : "Codex CLI unavailable",
    };
  }
}

async function withApiFallback<T>(
  codexFn: () => Promise<T>,
  apiFn: () => Promise<T>,
): Promise<T> {
  if (env().DM_LLM_PROVIDER === "openai-api") return apiFn();

  try {
    return await codexFn();
  } catch (codexError) {
    logger.warn(
      { err: formatError(codexError) },
      "Codex CLI DM provider failed; trying API fallback",
    );
    try {
      return await apiFn();
    } catch (apiError) {
      throw new Error(
        `Codex CLI failed (${formatError(
          codexError,
        )}); API fallback failed (${formatError(apiError)})`,
      );
    }
  }
}

async function completeOpenAIChat(
  opts: CompleteChatOptions,
): Promise<LlmChatResult> {
  const config = await resolveOpenAIFallbackConfig(opts.userId);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const resp = await client.chat.completions.create({
    model: config.modelDm,
    messages: opts.messages,
    tools: opts.tools && opts.tools.length > 0 ? opts.tools : undefined,
    tool_choice: opts.tools && opts.tools.length > 0 ? "auto" : undefined,
    max_completion_tokens: opts.maxCompletionTokens,
    temperature: opts.temperature,
  });

  const msg = resp.choices[0]?.message;
  return {
    provider: "openai-api",
    model: config.modelDm,
    content: msg?.content ?? "",
    toolCalls: msg?.tool_calls ?? [],
    tokensUsed: resp.usage?.total_tokens ?? 0,
  };
}

async function completeOpenAIJsonObject(
  opts: CompleteJsonOptions,
): Promise<{ value: unknown }> {
  const config = await resolveOpenAIFallbackConfig(opts.userId);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const resp = await client.chat.completions.create({
    model: config.modelDm,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature,
    max_completion_tokens: opts.maxCompletionTokens,
  });
  return { value: parseModelJson(resp.choices[0]?.message?.content ?? "{}") };
}

async function completeCodexChat(
  opts: CompleteChatOptions,
): Promise<LlmChatResult> {
  const prompt = [
    "You are Plum Tabletop's DM model runtime. This is not a coding task.",
    "Do not inspect files, edit files, or run shell commands. Use only the conversation and tools listed below.",
    "Return exactly one JSON object matching the supplied output schema.",
    "When tools are available, player-facing DM output belongs in tool_calls, especially narrate, request_skill_check, set_scene, start_combat, roll_dice, and update_world_state.",
    "Use content only as a brief internal fallback after all needed tool calls. Do not make content the main table experience.",
    "Use only listed tool names. Tool arguments must be compact JSON object strings.",
    opts.tools && opts.tools.length > 0
      ? "AVAILABLE TOOLS:\n" + renderTools(opts.tools)
      : "No tools are available for this request.",
    "CONVERSATION:\n" + renderMessages(opts.messages),
  ].join("\n\n");

  const settings = await codexDmSettings(opts.userId);
  const raw = await runCodexExec({
    prompt,
    settings,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string" },
        tool_calls: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              arguments: { type: "string" },
            },
            required: ["name", "arguments"],
          },
        },
      },
      required: ["content", "tool_calls"],
    },
  });

  const parsed = codexChatSchema.parse(parseModelJson(raw));
  return {
    provider: "codex-cli",
    model: settings.effectiveModel,
    content: parsed.content,
    toolCalls: parsed.tool_calls.map((call) => ({
      id: call.id ?? `call_${randomUUID().replace(/-/g, "")}`,
      type: "function" as const,
      function: {
        name: call.name,
        arguments:
          typeof call.arguments === "string"
            ? call.arguments
            : JSON.stringify(call.arguments),
      },
    })),
    tokensUsed: 0,
  };
}

async function completeCodexJsonObject(
  opts: CompleteJsonOptions,
): Promise<{ value: unknown }> {
  const prompt = [
    "You are Plum Tabletop's model runtime. This is not a coding task.",
    "Do not inspect files, edit files, or run shell commands.",
    "Return exactly one JSON object matching the user's requested schema. No markdown, no commentary.",
    "SYSTEM INSTRUCTIONS:\n" + opts.system,
    "USER REQUEST:\n" + opts.user,
  ].join("\n\n");

  const settings = await codexDmSettings(opts.userId);
  const raw = await runCodexExec({
    prompt,
    settings,
  });
  return { value: parseModelJson(raw) };
}

async function runCodexExec(opts: {
  prompt: string;
  settings: CodexDmSettings;
  outputSchema?: Record<string, unknown>;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "plum-codex-"));
  const schemaPath = opts.outputSchema ? path.join(dir, "schema.json") : null;
  const outputPath = path.join(dir, "last-message.json");

  try {
    if (schemaPath) {
      await writeFile(schemaPath, JSON.stringify(opts.outputSchema), "utf8");
    }
    const result = await runProcess(
      codexCommand(),
      buildCodexExecArgs({
        cwd: dir,
        schemaPath,
        outputPath,
        model: opts.settings.effectiveModel,
        reasoningEffort: opts.settings.effectiveReasoningEffort,
      }),
      opts.prompt,
      env().CODEX_EXEC_TIMEOUT_SECONDS * 1000,
      dir,
    );

    if (result.code !== 0) {
      throw new Error(
        `codex exec exited ${result.code}: ${compactProcessOutput(result)}`,
      );
    }

    const fromFile = await readFile(outputPath, "utf8").catch(() => "");
    const text = fromFile.trim() || result.stdout.trim();
    if (!text) throw new Error("codex exec returned an empty response");
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function codexCommand() {
  const candidates = [
    process.env.CODEX_BIN,
    "/app/node_modules/.bin/codex",
    path.join(process.cwd(), "node_modules/.bin/codex"),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? "codex";
}

function codexEnv() {
  const home =
    process.env.HOME ||
    (existsSync("/home/nextjs") ? "/home/nextjs" : tmpdir());
  const localBin = path.join(process.cwd(), "node_modules/.bin");
  const pathValue = ["/app/node_modules/.bin", localBin, process.env.PATH]
    .filter(Boolean)
    .join(":");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: pathValue,
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1",
  };

  delete childEnv.OPENAI_API_KEY;
  delete childEnv.OPENAI_BASE_URL;
  return childEnv;
}

function runProcess(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd?: string,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: codexEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_PROCESS_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_PROCESS_OUTPUT_CHARS);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function renderTools(tools: ChatCompletionTool[]) {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
    null,
    2,
  );
}

function renderMessages(messages: ChatCompletionMessageParam[]) {
  return messages
    .map((message, index) => {
      const msg = message as unknown as Record<string, unknown>;
      const parts = [`#${index + 1} role=${message.role}`];
      if (typeof msg.name === "string") parts.push(`name=${msg.name}`);
      if (typeof msg.tool_call_id === "string")
        parts.push(`tool_call_id=${msg.tool_call_id}`);

      const content = renderContent(msg.content);
      if (content) parts.push("content:\n" + content);

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        parts.push("tool_calls:\n" + JSON.stringify(msg.tool_calls, null, 2));
      }

      return parts.join("\n");
    })
    .join("\n\n");
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const extracted = extractFirstJsonValue(text);
    if (!extracted) throw new Error("model returned non-JSON output");
    return JSON.parse(extracted);
  }
}

function extractFirstJsonValue(text: string) {
  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;

    const stack: string[] = [opener === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
        continue;
      }

      if (char === "}" || char === "]") {
        if (stack.at(-1) !== char) break;
        stack.pop();
        if (stack.length === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

function compactProcessOutput(result: { stdout: string; stderr: string }) {
  const combined = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();
  return combined.slice(-2_000) || "no output";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
