import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCodexExecArgs } from "@/lib/dm/codex-args";

const spawnMock = vi.hoisted(() => vi.fn());
const codexDmSettingsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    userModel: "gpt-5.5",
    userReasoningEffort: "high",
    effectiveModel: "gpt-5.5",
    effectiveReasoningEffort: "high",
  }),
);

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("@/lib/dm/codex-settings", () => ({
  codexDmSettings: codexDmSettingsMock,
}));

const base = {
  cwd: "/tmp/plum-codex-test",
  schemaPath: "/tmp/plum-codex-test/schema.json",
  outputPath: "/tmp/plum-codex-test/last-message.json",
  reasoningEffort: "medium" as const,
};

function mockCodexOutput(output: string) {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();

    const outputPath = args[args.indexOf("--output-last-message") + 1];
    queueMicrotask(() => {
      writeFileSync(outputPath, output, "utf8");
      child.emit("exit", 0, null);
    });
    return child;
  });
}

describe("Codex runtime settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    codexDmSettingsMock.mockClear();
    vi.stubEnv("NODE_ENV", "test");
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.S3_ACCESS_KEY = "test";
    process.env.S3_SECRET_KEY = "test";
    process.env.SECRET_BOX_KEY =
      "0000000000000000000000000000000000000000000000000000000000000000";
    process.env.INVITE_HMAC_SECRET = "test-invite-secret";
    process.env.DM_LLM_PROVIDER = "codex-cli";
    process.env.CODEX_MODEL_DM = "auto";
    process.env.CODEX_REASONING_EFFORT_DM = "medium";
    process.env.CODEX_EXEC_TIMEOUT_SECONDS = "10";
  });

  it("passes effective settings to Codex chat and reports the effective model", async () => {
    mockCodexOutput(JSON.stringify({ content: "Ready.", tool_calls: [] }));
    const { completeDmChat } = await import("@/lib/dm/llm");

    const result = await completeDmChat({
      userId: "user_1",
      messages: [{ role: "user", content: "Begin." }],
    });

    expect(codexDmSettingsMock).toHaveBeenCalledOnce();
    expect(codexDmSettingsMock).toHaveBeenCalledWith("user_1");
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.5");
    expect(args[args.indexOf("-c") + 1]).toBe(
      'model_reasoning_effort="high"',
    );
    expect(result.model).toBe("gpt-5.5");
  });

  it("passes effective settings to Codex JSON object calls", async () => {
    mockCodexOutput(JSON.stringify({ ok: true }));
    const { completeDmJsonObject } = await import("@/lib/dm/llm");

    await completeDmJsonObject({
      userId: "user_2",
      system: "Return JSON.",
      user: "Return { ok: true }.",
    });

    expect(codexDmSettingsMock).toHaveBeenCalledOnce();
    expect(codexDmSettingsMock).toHaveBeenCalledWith("user_2");
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.5");
    expect(args[args.indexOf("-c") + 1]).toBe(
      'model_reasoning_effort="high"',
    );
  });
});

describe("Codex exec argv", () => {
  it("passes approval policy before the exec subcommand", () => {
    const args = buildCodexExecArgs({ ...base, model: "gpt-5.5" });

    expect(args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
    expect(args.indexOf("--ask-for-approval")).toBeLessThan(
      args.indexOf("exec"),
    );
  });

  it.each(["", "   ", "auto", "DeFaUlT"])(
    "omits --model for the installation-default sentinel %j",
    (model) => {
      const args = buildCodexExecArgs({ ...base, model });

      expect(args).not.toContain("--model");
      expect(args).toContain("-c");
      expect(args[args.indexOf("-c") + 1]).toBe(
        'model_reasoning_effort="medium"',
      );
    },
  );

  it("passes an explicit Codex model when configured", () => {
    const args = buildCodexExecArgs({ ...base, model: "gpt-5.5" });

    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.5");
  });

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

  it("omits --output-schema when no schema is provided", () => {
    const args = buildCodexExecArgs({
      cwd: base.cwd,
      outputPath: base.outputPath,
      schemaPath: null,
      model: "auto",
      reasoningEffort: "medium",
    });

    expect(args).not.toContain("--output-schema");
  });
});

describe("Codex JSON object completion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    vi.stubEnv("NODE_ENV", "test");
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.S3_ACCESS_KEY = "test";
    process.env.S3_SECRET_KEY = "test";
    process.env.SECRET_BOX_KEY =
      "0000000000000000000000000000000000000000000000000000000000000000";
    process.env.INVITE_HMAC_SECRET = "test-invite-secret";
    process.env.DM_LLM_PROVIDER = "codex-cli";
    process.env.CODEX_MODEL_DM = "auto";
    process.env.CODEX_EXEC_TIMEOUT_SECONDS = "10";
  });

  it("does not pass large JSON schemas to codex exec for JSON object calls", async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();

      const outputPath = args[args.indexOf("--output-last-message") + 1];
      queueMicrotask(() => {
        writeFileSync(outputPath, JSON.stringify({ ok: true }), "utf8");
        child.emit("exit", 0, null);
      });
      return child;
    });

    const { completeDmJsonObject } = await import("@/lib/dm/llm");

    await expect(
      completeDmJsonObject({
        userId: "user_1",
        system: "Return JSON.",
        user: "Return { ok: true }.",
        outputSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      }),
    ).resolves.toEqual({ ok: true });

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--output-last-message");
    expect(args).not.toContain("--output-schema");
  });

  it("parses the first complete JSON object when codex appends extra output", async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();

      const outputPath = args[args.indexOf("--output-last-message") + 1];
      queueMicrotask(() => {
        writeFileSync(
          outputPath,
          '{"ok":true,"nested":{"value":"brace } inside string"}}\n{"extra":true}',
          "utf8",
        );
        child.emit("exit", 0, null);
      });
      return child;
    });

    const { completeDmJsonObject } = await import("@/lib/dm/llm");

    await expect(
      completeDmJsonObject({
        userId: "user_1",
        system: "Return JSON.",
        user: "Return { ok: true }.",
      }),
    ).resolves.toEqual({
      ok: true,
      nested: { value: "brace } inside string" },
    });
  });
});
