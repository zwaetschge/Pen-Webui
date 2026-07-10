# Per-DM Codex Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each DM choose the Codex CLI model and reasoning effort in the web settings UI, effective on the next DM invocation without a restart.

**Architecture:** Persist nullable user overrides and resolve them over installation defaults at each Codex invocation. Keep CLI argument construction pure and allow-list reasoning values before they can reach the spawned process.

**Tech Stack:** TypeScript, Prisma/Postgres, Zod, Next.js 15 Route Handlers, React 19, Vitest, Codex CLI 0.134

## Global Constraints

- Settings are DM-only and scoped to the authenticated `User`.
- Environment values remain installation defaults.
- Accepted efforts are exactly `minimal`, `low`, `medium`, `high`, and `xhigh`.
- Empty model, `auto`, and `default` produce no explicit `--model` argument.
- Model values are process arguments, never shell-interpolated.
- API fallback credentials and asset image generation behavior remain unchanged.

---

### Task 1: Persist and resolve Codex runtime settings

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710160000_per_dm_codex_settings/migration.sql`
- Create: `src/lib/dm/codex-settings.ts`
- Create: `src/lib/dm/codex-settings.test.ts`
- Modify: `src/lib/env.ts`

**Interfaces:**
- Produces: `CodexReasoningEffort`
- Produces: `codexDmSettings(userId): Promise<CodexDmSettings>`
- Produces: `setUserCodexDmSettings(userId, values): Promise<void>`
- Produces: effective `{ model, reasoningEffort }` for runtime calls

- [ ] **Step 1: Write failing resolver and persistence tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user } }));

describe("per-DM Codex settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CODEX_MODEL_DM", "gpt-installation-default");
    vi.stubEnv("CODEX_REASONING_EFFORT_DM", "medium");
  });

  it("resolves user overrides over environment defaults", async () => {
    user.findUnique.mockResolvedValue({
      codexModelDm: "gpt-5.5",
      codexReasoningEffort: "high",
    });
    const { codexDmSettings } = await import("./codex-settings");
    await expect(codexDmSettings("dm-a")).resolves.toMatchObject({
      userModel: "gpt-5.5",
      userReasoningEffort: "high",
      effectiveModel: "gpt-5.5",
      effectiveReasoningEffort: "high",
    });
  });

  it("uses environment defaults for a user without overrides", async () => {
    user.findUnique.mockResolvedValue({
      codexModelDm: null,
      codexReasoningEffort: null,
    });
    const { codexDmSettings } = await import("./codex-settings");
    await expect(codexDmSettings("dm-b")).resolves.toMatchObject({
      effectiveModel: "gpt-installation-default",
      effectiveReasoningEffort: "medium",
    });
  });

  it("normalizes default selections to null", async () => {
    const { setUserCodexDmSettings } = await import("./codex-settings");
    await setUserCodexDmSettings("dm-a", {
      model: "auto",
      reasoningEffort: null,
    });
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "dm-a" },
      data: { codexModelDm: null, codexReasoningEffort: null },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `./node_modules/.bin/vitest run src/lib/dm/codex-settings.test.ts`

Expected: FAIL because the module and Prisma fields do not exist.

- [ ] **Step 3: Add schema, migration, and environment default**

Add to `User`:

```prisma
codexModelDm         String?
codexReasoningEffort String?
```

Migration:

```sql
ALTER TABLE "User" ADD COLUMN "codexModelDm" TEXT;
ALTER TABLE "User" ADD COLUMN "codexReasoningEffort" TEXT;
```

Environment schema:

```ts
CODEX_REASONING_EFFORT_DM: z
  .enum(["minimal", "low", "medium", "high", "xhigh"])
  .default("medium"),
```

- [ ] **Step 4: Implement the settings service**

```ts
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const CODEX_REASONING_EFFORTS = [
  "minimal", "low", "medium", "high", "xhigh",
] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export type CodexDmSettings = {
  userModel: string | null;
  userReasoningEffort: CodexReasoningEffort | null;
  effectiveModel: string;
  effectiveReasoningEffort: CodexReasoningEffort;
};

export async function codexDmSettings(userId: string): Promise<CodexDmSettings> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { codexModelDm: true, codexReasoningEffort: true },
  });
  const userModel = normalizeModel(row?.codexModelDm);
  const userReasoningEffort = normalizeEffort(row?.codexReasoningEffort);
  return {
    userModel,
    userReasoningEffort,
    effectiveModel: userModel ?? env().CODEX_MODEL_DM,
    effectiveReasoningEffort:
      userReasoningEffort ?? env().CODEX_REASONING_EFFORT_DM,
  };
}

export async function setUserCodexDmSettings(
  userId: string,
  values: {
    model?: string | null;
    reasoningEffort?: CodexReasoningEffort | null;
  },
) {
  const data: {
    codexModelDm?: string | null;
    codexReasoningEffort?: string | null;
  } = {};
  if (values.model !== undefined) data.codexModelDm = normalizeModel(values.model);
  if (values.reasoningEffort !== undefined) {
    data.codexReasoningEffort = values.reasoningEffort;
  }
  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: userId }, data });
  }
}

function normalizeModel(value: string | null | undefined) {
  const model = value?.trim();
  if (!model || ["auto", "default"].includes(model.toLowerCase())) return null;
  if (model.length > 120) throw new Error("Codex model name is too long");
  return model;
}

function normalizeEffort(value: string | null | undefined) {
  return CODEX_REASONING_EFFORTS.find((effort) => effort === value) ?? null;
}
```

- [ ] **Step 5: Generate Prisma client and verify GREEN**

Run:

```bash
npx prisma generate
./node_modules/.bin/vitest run src/lib/dm/codex-settings.test.ts
```

Expected: Prisma generation succeeds and 3 focused tests pass.

- [ ] **Step 6: Commit persistence and resolver**

```bash
git add prisma/schema.prisma prisma/migrations/20260710160000_per_dm_codex_settings/migration.sql src/lib/env.ts src/lib/dm/codex-settings.ts src/lib/dm/codex-settings.test.ts
git commit -m "feat: persist per-DM codex settings"
```

---

### Task 2: Pass effective settings to every Codex DM call

**Files:**
- Modify: `src/lib/dm/codex-args.ts`
- Modify: `src/lib/dm/llm.ts`
- Modify: `src/lib/__tests__/llm.test.ts`

**Interfaces:**
- Consumes: `codexDmSettings(userId)`
- Produces: `buildCodexExecArgs({ ..., model, reasoningEffort })`

- [ ] **Step 1: Add failing argument and invocation tests**

```ts
it("passes the configured reasoning effort as a Codex config override", () => {
  const args = buildCodexExecArgs({
    ...base,
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
  expect(args).toContain("-c");
  expect(args[args.indexOf("-c") + 1]).toBe(
    'model_reasoning_effort="high"',
  );
});
```

Mock the resolver in the spawned-process suite:

```ts
vi.mock("@/lib/dm/codex-settings", () => ({
  codexDmSettings: vi.fn().mockResolvedValue({
    userModel: "gpt-5.5",
    userReasoningEffort: "high",
    effectiveModel: "gpt-5.5",
    effectiveReasoningEffort: "high",
  }),
}));
```

Assert spawned arguments contain both model and effort values.

- [ ] **Step 2: Run and verify RED**

Run: `./node_modules/.bin/vitest run src/lib/__tests__/llm.test.ts`

Expected: FAIL because `reasoningEffort` is not accepted or emitted.

- [ ] **Step 3: Extend the argument builder**

```ts
import type { CodexReasoningEffort } from "./codex-settings";

export function buildCodexExecArgs(opts: {
  cwd: string;
  schemaPath?: string | null;
  outputPath: string;
  model: string;
  reasoningEffort: CodexReasoningEffort;
}) {
  return [
    "--ask-for-approval", "never", "exec",
    "--skip-git-repo-check", "--ephemeral", "--ignore-rules",
    "--sandbox", "read-only", "--cd", opts.cwd, "--color", "never",
    ...codexModelArgs(opts.model),
    "-c", `model_reasoning_effort=${JSON.stringify(opts.reasoningEffort)}`,
    ...codexOutputSchemaArgs(opts.schemaPath),
    "--output-last-message", opts.outputPath, "-",
  ];
}
```

- [ ] **Step 4: Resolve settings once per Codex call**

In `completeCodexChat` and `completeCodexJsonObject`:

```ts
const settings = await codexDmSettings(opts.userId);
const raw = await runCodexExec({ prompt, outputSchema, settings });
```

Change `runCodexExec` to accept effective settings and pass them to
`buildCodexExecArgs`. Return `settings.effectiveModel` in `LlmChatResult`
instead of reading `env().CODEX_MODEL_DM` after the call.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `./node_modules/.bin/vitest run src/lib/__tests__/llm.test.ts`

Expected: all Codex argument and JSON-completion tests pass.

- [ ] **Step 6: Commit runtime propagation**

```bash
git add src/lib/dm/codex-args.ts src/lib/dm/llm.ts src/lib/__tests__/llm.test.ts
git commit -m "feat: apply per-DM codex runtime settings"
```

---

### Task 3: Expose and edit settings through the DM UI

**Files:**
- Modify: `src/app/api/dm/settings/route.ts`
- Create: `src/app/api/dm/settings/route.test.ts`
- Modify: `src/app/dm/settings/_components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `codexDmSettings`, `setUserCodexDmSettings`
- API input: `{ codexModelDm?: string | null; codexReasoningEffort?: CodexReasoningEffort | null }`
- API output: `codexRuntime: CodexDmSettings`

- [ ] **Step 1: Write failing API tests**

Mock `requireDM`, fallback settings, and Codex settings. POST:

```ts
{ codexModelDm: "gpt-5.5", codexReasoningEffort: "high" }
```

and assert:

```ts
expect(setUserCodexDmSettings).toHaveBeenCalledWith("dm-a", {
  model: "gpt-5.5",
  reasoningEffort: "high",
});
```

Post `codexReasoningEffort: "maximum"` and expect HTTP 400 with no persistence
call. Add a GET test asserting user and effective values under `codexRuntime`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `./node_modules/.bin/vitest run src/app/api/dm/settings/route.test.ts`

Expected: FAIL because the route ignores Codex overrides.

- [ ] **Step 3: Extend the route schema and handlers**

```ts
const reasoningEffortSchema = z.enum([
  "minimal", "low", "medium", "high", "xhigh",
]);

const schema = z.object({
  openaiKey: z.string().optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  openaiModelDm: z.string().nullable().optional(),
  clearKey: z.boolean().optional(),
  codexModelDm: z.string().max(120).nullable().optional(),
  codexReasoningEffort: reasoningEffortSchema.nullable().optional(),
});
```

Load `codexDmSettings(user.id)` in GET. In POST, call
`setUserCodexDmSettings` only when a Codex field is present, reload effective
settings, and return them as `codexRuntime`.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `./node_modules/.bin/vitest run src/app/api/dm/settings/route.test.ts`

Expected: GET, valid POST, and invalid-effort tests pass.

- [ ] **Step 5: Add the dedicated Codex UI panel**

Extend `SettingsState`:

```ts
codexRuntime: {
  userModel: string | null;
  userReasoningEffort:
    | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  effectiveModel: string;
  effectiveReasoningEffort:
    | "minimal" | "low" | "medium" | "high" | "xhigh";
};
```

Use independent state and save action:

```ts
const [codexModelInput, setCodexModelInput] = useState("");
const [codexEffortInput, setCodexEffortInput] = useState("");

async function saveCodex() {
  const response = await fetch("/api/dm/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      codexModelDm: codexModelInput.trim() || null,
      codexReasoningEffort: codexEffortInput || null,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Codex settings failed");
  setSettings((current) =>
    current ? { ...current, codexRuntime: body.codexRuntime } : current,
  );
}
```

Render a `Codex CLI` section above `OpenAI API`: model input with the effective
model as placeholder, effort select with blank `Installation default` plus the
five values, effective-value summary, and `Save Codex settings`. Keep the API
fallback form and save action independent.

- [ ] **Step 6: Typecheck the route and component**

Run: `npm run typecheck`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 7: Commit settings API and UI**

```bash
git add src/app/api/dm/settings/route.ts src/app/api/dm/settings/route.test.ts src/app/dm/settings/_components/SettingsForm.tsx
git commit -m "feat: configure codex from DM settings"
```

---

### Task 4: Configuration docs and full verification

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/ops.md`

**Interfaces:**
- Produces: documented `CODEX_REASONING_EFFORT_DM` installation default

- [ ] **Step 1: Add deployment defaults and operator documentation**

Add alongside `CODEX_MODEL_DM`:

```dotenv
# Default for DMs without a saved override: minimal|low|medium|high|xhigh
CODEX_REASONING_EFFORT_DM=medium
```

Add to the shared Compose environment:

```yaml
CODEX_REASONING_EFFORT_DM: ${CODEX_REASONING_EFFORT_DM:-medium}
```

Document that `/dm/settings` values override both defaults for the next model
call and that migration deploy is required for the new User columns.

- [ ] **Step 2: Validate schema and generated client**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: both commands exit 0.

- [ ] **Step 3: Run complete project checks**

Run in order:

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: lint has zero warnings/errors, typecheck exits 0, full pinned Vitest
suite passes, production build exits 0, and diff check reports nothing.

- [ ] **Step 4: Commit documentation and configuration**

```bash
git add .env.example docker-compose.yml README.md docs/ops.md
git commit -m "docs: explain codex model and effort overrides"
```

