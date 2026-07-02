import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "@/lib/dm/codex-args";

const base = {
  cwd: "/tmp/plum-codex-test",
  schemaPath: "/tmp/plum-codex-test/schema.json",
  outputPath: "/tmp/plum-codex-test/last-message.json",
};

describe("Codex exec argv", () => {
  it("passes approval policy before the exec subcommand", () => {
    const args = buildCodexExecArgs({ ...base, model: "gpt-5.5" });

    expect(args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
    expect(args.indexOf("--ask-for-approval")).toBeLessThan(
      args.indexOf("exec"),
    );
  });

  it("omits --model when CODEX_MODEL_DM is auto", () => {
    const args = buildCodexExecArgs({ ...base, model: "auto" });

    expect(args).not.toContain("--model");
  });

  it("passes an explicit Codex model when configured", () => {
    const args = buildCodexExecArgs({ ...base, model: "gpt-5.5" });

    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.5");
  });

  it("omits --output-schema when no schema is provided", () => {
    const args = buildCodexExecArgs({
      cwd: base.cwd,
      outputPath: base.outputPath,
      schemaPath: null,
      model: "auto",
    });

    expect(args).not.toContain("--output-schema");
  });
});
