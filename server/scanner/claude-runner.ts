/**
 * Shared utility for running `claude -p` as a subprocess.
 * Used by: session-summarizer, nl-query, decision-extractor, ai-suggest
 */
import { spawn } from "child_process";

interface RunClaudeOpts {
  model?: string;
  timeoutMs?: number;
  maxTurns?: number;
}

/** Run claude -p with a prompt, return the stdout */
export function runClaude(prompt: string, opts: RunClaudeOpts = {}): Promise<string> {
  const { model = "haiku", timeoutMs = 60000, maxTurns = 1 } = opts;

  return new Promise((resolve, reject) => {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.CLAUDECODE;

    const args = ["-p", "--model", model, "--max-turns", String(maxTurns), "--no-session-persistence"];
    const child = spawn("claude", args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Parse JSON from Claude output (handles markdown fences) */
export function parseClaudeJson(raw: string): Record<string, unknown> | unknown[] | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf("```");
    if (lastFence !== -1) cleaned = cleaned.slice(0, lastFence);
    cleaned = cleaned.trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
