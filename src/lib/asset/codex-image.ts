import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../env";
import { resolveCodexExecutable } from "../dm/codex-cli";

const MAX_PROCESS_OUTPUT_CHARS = 512_000;

export type CodexImageResult = {
  png: Buffer;
  backend: "codex-cli";
};

export async function generateCodexImage(opts: {
  prompt: string;
  kind: string;
}): Promise<CodexImageResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "plum-codex-image-"));
  const outputPath = path.join(dir, "out.png");
  const lastMessagePath = path.join(dir, "last-message.txt");

  try {
    const result = await runProcess(
      resolveCodexExecutable().command,
      [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-rules",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        dir,
        "--color",
        "never",
        "--json",
        "--output-last-message",
        lastMessagePath,
        "-c",
        'auth_mode="chatgpt"',
        codexImagePrompt(opts),
      ],
      env().CODEX_EXEC_TIMEOUT_SECONDS * 1000,
      dir,
    );

    if (result.code !== 0) {
      throw new Error(
        `codex exec exited ${result.code}: ${compactProcessOutput(result)}`,
      );
    }

    const direct = await readFile(outputPath).catch(() => null);
    if (direct && direct.length > 0) {
      return { png: direct, backend: "codex-cli" };
    }

    const generated = await readLatestGeneratedImage(result.stdout);
    if (generated) return { png: generated, backend: "codex-cli" };

    const lastMessage = await readFile(lastMessagePath, "utf8").catch(() => "");
    throw new Error(
      `codex image generation did not produce out.png${lastMessage ? `: ${lastMessage.trim()}` : ""}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function codexImagePrompt(opts: { prompt: string; kind: string }) {
  return [
    "Use the built-in image generation tool to create one project-bound PNG asset.",
    "Do not use OpenAI API scripts or OPENAI_API_KEY. Use the Codex/ChatGPT image generation capability.",
    "Do not inspect this repository. Only generate the image and place the final PNG at ./out.png.",
    `Asset kind: ${opts.kind}`,
    "Output file: out.png",
    "After the PNG exists, finish with exactly: DONE out.png",
    "Image prompt:",
    opts.prompt,
  ].join("\n\n");
}

async function readLatestGeneratedImage(stdout: string) {
  const threadId = parseThreadId(stdout);
  if (!threadId) return null;

  const generatedDir = path.join(codexHome(), "generated_images", threadId);
  const entries = await readdir(generatedDir).catch(() => []);
  const pngs = await Promise.all(
    entries
      .filter((entry) => entry.toLowerCase().endsWith(".png"))
      .map(async (entry) => {
        const filePath = path.join(generatedDir, entry);
        const fileStat = await stat(filePath).catch(() => null);
        return fileStat ? { filePath, mtimeMs: fileStat.mtimeMs } : null;
      }),
  );
  const latest = pngs
    .filter((entry): entry is { filePath: string; mtimeMs: number } => !!entry)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return latest ? readFile(latest.filePath) : null;
}

function parseThreadId(stdout: string) {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; thread_id?: string };
      if (parsed.type === "thread.started" && parsed.thread_id) {
        return parsed.thread_id;
      }
    } catch {
      // Ignore progress lines that are not JSON events.
    }
  }
  return null;
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(codexUserHome(), ".codex");
}

function codexUserHome() {
  return (
    process.env.HOME || (existsSync("/home/nextjs") ? "/home/nextjs" : tmpdir())
  );
}

function codexEnv() {
  const home = codexUserHome();
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
  timeoutMs: number,
  cwd: string,
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
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

function compactProcessOutput(result: { stdout: string; stderr: string }) {
  return [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-4000);
}
