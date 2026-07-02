import { describe, expect, it } from "vitest";
import { terminalShellCommand, terminalShellPath } from "@/lib/dm/terminal";

describe("terminal shell helpers", () => {
  it("falls back to /bin/sh when SHELL is missing or unsafe", () => {
    expect(terminalShellPath(undefined)).toBe("/bin/sh");
    expect(terminalShellPath("")).toBe("/bin/sh");
    expect(terminalShellPath("sh")).toBe("/bin/sh");
    expect(terminalShellPath("/bin/sh -c bad")).toBe("/bin/sh");
  });

  it("starts the configured shell in interactive mode", () => {
    expect(terminalShellCommand("/bin/sh")).toBe("/bin/sh -i");
    expect(terminalShellCommand("/bin/bash")).toBe("/bin/bash -i");
  });
});
