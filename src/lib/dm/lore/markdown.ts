import { createHash } from "node:crypto";

import type { PreparedLoreSource } from "./types";

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function prepareMarkdownLoreFile(
  file: File,
): Promise<PreparedLoreSource> {
  if (!file.name.toLowerCase().endsWith(".md")) {
    throw new Error("Only .md lore files are supported");
  }
  if (file.size > MAX_MARKDOWN_BYTES) {
    throw new Error("Lore file is too large");
  }

  const raw = decodeUtf8Markdown(await file.arrayBuffer());
  const text = stripFrontmatter(raw).trim();
  const contentHash = createHash("sha256").update(text, "utf8").digest("hex");

  return {
    kind: "upload",
    title: file.name,
    rawText: text,
    summary: "",
    facts: [],
    citations: [],
    contentHash,
  };
}

function stripFrontmatter(value: string) {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function decodeUtf8Markdown(buffer: ArrayBuffer) {
  let decoded: string;
  try {
    decoded = decoder.decode(new Uint8Array(buffer));
  } catch {
    throw new Error("Lore file must be valid UTF-8 text");
  }

  if (hasBinaryContent(decoded)) {
    throw new Error("Lore file must be plain UTF-8 text");
  }

  return decoded;
}

function hasBinaryContent(value: string) {
  let disallowedControlChars = 0;

  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;

    if (codePoint === 0) {
      return true;
    }

    const isAllowedWhitespace =
      codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    const isDisallowedControl =
      !isAllowedWhitespace &&
      ((codePoint >= 0x00 && codePoint <= 0x1f) || codePoint === 0x7f);

    if (isDisallowedControl) {
      disallowedControlChars += 1;
    }
  }

  return (
    disallowedControlChars > 0 &&
    (disallowedControlChars > 8 ||
      disallowedControlChars / Math.max(value.length, 1) > 0.01)
  );
}
