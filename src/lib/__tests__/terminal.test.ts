import { afterEach, describe, expect, it } from "vitest";
import { terminalShellCommand, terminalShellPath } from "@/lib/dm/terminal";

describe("terminal shell helpers", () => {
  const originalShell = process.env.SHELL;

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
  });

  it("falls back to /bin/sh when SHELL is missing or unsafe", () => {
    delete process.env.SHELL;

    expect(terminalShellPath()).toBe("/bin/sh");
    expect(terminalShellPath("")).toBe("/bin/sh");
    expect(terminalShellPath("sh")).toBe("/bin/sh");
    expect(terminalShellPath("/bin/sh -c bad")).toBe("/bin/sh");
  });

  it("uses a safe configured shell by default", () => {
    process.env.SHELL = "/bin/bash";

    expect(terminalShellPath()).toBe("/bin/bash");
  });

  it("starts the configured shell in interactive mode", () => {
    expect(terminalShellCommand("/bin/sh")).toBe("/bin/sh -i");
    expect(terminalShellCommand("/bin/bash")).toBe("/bin/bash -i");
  });
});
