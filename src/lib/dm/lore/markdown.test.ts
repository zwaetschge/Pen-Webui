import { describe, expect, it } from "vitest";

import { prepareMarkdownLoreFile } from "./markdown";

function file(name: string, text: string, type = "text/markdown") {
  return new File([text], name, { type });
}

function binaryFile(name: string, bytes: Uint8Array, type = "text/markdown") {
  return new File([bytes], name, { type });
}

describe("prepareMarkdownLoreFile", () => {
  it("accepts markdown and strips frontmatter", async () => {
    const source = await prepareMarkdownLoreFile(
      file("novel.md", "---\ntitle: Draft\n---\n# Kapitel 1\nMira kommt heim."),
    );

    expect(source.title).toBe("novel.md");
    expect(source.rawText).toBe("# Kapitel 1\nMira kommt heim.");
    expect(source.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported extensions", async () => {
    await expect(prepareMarkdownLoreFile(file("novel.pdf", "x"))).rejects.toThrow(
      "Only .md lore files are supported",
    );
  });

  it("rejects markdown files over 2 MB", async () => {
    const tooLarge = "x".repeat(2 * 1024 * 1024 + 1);
    await expect(prepareMarkdownLoreFile(file("big.md", tooLarge))).rejects.toThrow(
      "Lore file is too large",
    );
  });

  it("rejects invalid UTF-8 bytes", async () => {
    await expect(
      prepareMarkdownLoreFile(binaryFile("broken.md", new Uint8Array([0xff, 0xfe]))),
    ).rejects.toThrow("Lore file must be valid UTF-8 text");
  });

  it("rejects binary content renamed to markdown", async () => {
    await expect(
      prepareMarkdownLoreFile(
        binaryFile("binary.md", new Uint8Array([0x23, 0x20, 0x48, 0x69, 0x00, 0x41])),
      ),
    ).rejects.toThrow("Lore file must be plain UTF-8 text");
  });
});
