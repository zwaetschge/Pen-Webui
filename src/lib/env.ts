import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  VOCARIUM_API_URL: z.string().url().default("http://vocarium-api:8280"),

  S3_ENDPOINT: z.string().default("http://minio:9000"),
  S3_PUBLIC_URL: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("dnd-assets"),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),

  AUTHELIA_HEADER_USER: z.string().default("Remote-User"),
  AUTHELIA_HEADER_EMAIL: z.string().default("Remote-Email"),
  AUTHELIA_HEADER_GROUPS: z.string().default("Remote-Groups"),
  AUTHELIA_HEADER_NAME: z.string().default("Remote-Name"),
  AUTHELIA_DM_GROUP: z.string().default("dnd-dms"),

  SECRET_BOX_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 32-byte hex (64 chars)"),
  INVITE_HMAC_SECRET: z.string().min(16),
  CAST_AGENT_SOCKET: z.string().default("/run/plum-cast/agent.sock"),

  DM_LLM_PROVIDER: z.enum(["codex-cli", "openai-api"]).default("codex-cli"),
  CODEX_MODEL_DM: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : "auto";
    }),
  CODEX_REASONING_EFFORT_DM: z
    .enum(["minimal", "low", "medium", "high", "xhigh"])
    .default("medium"),
  CODEX_EXEC_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(180),
  ASSET_IMAGE_PROVIDER: z
    .enum(["codex-cli", "openai-api"])
    .default("codex-cli"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z
    .string()
    .optional()
    .transform((value) =>
      value && value.trim().length > 0 ? value : undefined,
    )
    .pipe(z.string().url().optional()),
  OPENAI_MODEL_DM: z.string().default("gpt-5"),
  OPENAI_MODEL_VISION: z.string().default("gpt-4o"),
  OPENAI_MODEL_EMBEDDING: z.string().default("text-embedding-3-large"),
  CODEX_WEB_RESEARCH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  ZAI_API_KEY: z.string().optional(),
  ZAI_WEB_SEARCH_MCP_URL: z
    .string()
    .url()
    .default("https://api.z.ai/api/mcp/web_search_prime/mcp"),
  SEARXNG_URL: z.string().url().default("http://192.168.1.40/search"),

  SETTINGS_TERMINAL_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  SETTINGS_TERMINAL_IDLE_MINUTES: z.coerce.number().int().min(1).default(15),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  SENTRY_DSN: z.string().optional(),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      console.error(
        "[env] invalid environment configuration:",
        parsed.error.format(),
      );
      throw new Error("Invalid environment configuration");
    }
    cached = parsed.data;
  }
  return cached;
}
