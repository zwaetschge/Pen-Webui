export function buildCodexExecArgs(opts: {
  cwd: string;
  schemaPath?: string | null;
  outputPath: string;
  model: string;
}) {
  return [
    "--ask-for-approval",
    "never",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--cd",
    opts.cwd,
    "--color",
    "never",
    ...codexModelArgs(opts.model),
    ...codexOutputSchemaArgs(opts.schemaPath),
    "--output-last-message",
    opts.outputPath,
    "-",
  ];
}

function codexModelArgs(model: string) {
  const trimmed = model.trim();
  if (!trimmed || ["auto", "default"].includes(trimmed.toLowerCase()))
    return [];
  return ["--model", trimmed];
}

function codexOutputSchemaArgs(schemaPath?: string | null) {
  return schemaPath ? ["--output-schema", schemaPath] : [];
}
