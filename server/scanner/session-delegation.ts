import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import type { SessionData, DelegationResult } from "@shared/types";
import { storage } from "../storage";
import { extractMessageText } from "./utils";

/** Build a continuation context prompt from session data */
export function buildContextPrompt(session: SessionData): string {
  const parts: string[] = [];
  const summary = storage.getSummary(session.id);
  const note = storage.getNote(session.id);

  parts.push(`# Continuation of session: ${session.firstMessage?.slice(0, 80) || session.slug}`);
  parts.push(`Session ID: ${session.id}`);
  parts.push(`Project: ${session.projectKey} | CWD: ${session.cwd}`);
  if (session.gitBranch) parts.push(`Branch: ${session.gitBranch}`);
  parts.push("");

  if (summary) {
    parts.push(`## Previous Summary`);
    parts.push(summary.summary);
    parts.push(`Outcome: ${summary.outcome}`);
    parts.push(`Topics: ${summary.topics.join(", ")}`);
    if (summary.filesModified.length > 0) parts.push(`Files: ${summary.filesModified.join(", ")}`);
    parts.push("");
  }

  if (note) {
    parts.push(`## User Note`);
    parts.push(note.text);
    parts.push("");
  }

  // Read last few messages from JSONL
  try {
    const content = fs.readFileSync(session.filePath, "utf-8");
    const lines = content.trim().split("\n");
    const lastLines = lines.slice(-20);
    const lastMsgs: string[] = [];
    for (const line of lastLines) {
      try {
        const record = JSON.parse(line.trim());
        if (record.type === "user") {
          const text = extractMessageText(record.message?.content, true);
          if (text && text.length > 5) lastMsgs.push(`USER: ${text.slice(0, 200)}`);
        } else if (record.type === "assistant") {
          const text = extractMessageText(record.message?.content, true);
          if (text && text.length > 5) lastMsgs.push(`ASSISTANT: ${text.slice(0, 200)}`);
        }
      } catch {}
    }
    if (lastMsgs.length > 0) {
      parts.push(`## Last Messages`);
      parts.push(lastMsgs.slice(-6).join("\n"));
    }
  } catch {}

  return parts.join("\n");
}

/** Sanitize a path for safe shell interpolation. Exported for unit testing. */
export function sanitizePath(p: string): string {
  // Remove any shell metacharacters except path separators, spaces, dots, hyphens
  return p.replace(/[^a-zA-Z0-9\s/\\:._\-]/g, "");
}

/**
 * Open a new terminal window sitting in `dir` (cross-platform). The directory
 * is sanitized here to prevent command injection. If `command` is provided it
 * runs after the `cd`; otherwise the shell just opens in the directory and
 * stays interactive. `command` MUST be built from sanitized/whitelisted tokens
 * by the caller — never pass raw user input.
 */
function spawnTerminalInDir(dir: string, command?: string): void {
  const env = { ...process.env, CLAUDECODE: undefined };
  const plat = process.platform;
  const cwd = sanitizePath(dir || process.cwd());
  let child;
  if (plat === "win32") {
    const winCwd = cwd.replace(/\//g, "\\");
    // Pass the directory as the spawn cwd (the new `start` window inherits it)
    // instead of interpolating the path into the command string — so a path
    // value can't break out of the command. sanitizePath stays as a 2nd layer.
    const inner = command ? `cmd /k "${command}"` : "cmd /k";
    child = spawn(`start "Claude Command Center" ${inner}`, [], {
      cwd: winCwd, detached: true, stdio: "ignore", shell: true, env: env as NodeJS.ProcessEnv,
    });
  } else if (plat === "darwin") {
    const safeCwd = cwd.replace(/'/g, "'\\''");
    const tail = command ? ` && ${command}` : "";
    child = spawn("osascript", ["-e", `tell application "Terminal" to do script "cd '${safeCwd}'${tail}"`], {
      detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv,
    });
  } else {
    const safeCwd = cwd.replace(/'/g, "'\\''");
    // Without a command, exec the user's shell so the terminal stays open.
    const inner = command ? `cd '${safeCwd}' && ${command}` : `cd '${safeCwd}' && exec "$SHELL"`;
    child = spawn("x-terminal-emulator", ["-e", "bash", "-c", inner], {
      detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv,
    });
  }
  child.on("error", () => {});
  child.unref();
}

/** Delegate to terminal — opens a new terminal with claude --resume in the session's cwd (cross-platform) */
export function delegateToTerminal(session: SessionData): DelegationResult {
  try {
    const rawCwd = session.cwd || process.cwd();
    const sid = session.id.replace(/[^a-f0-9-]/gi, ""); // UUID chars only
    spawnTerminalInDir(rawCwd, `claude --resume ${sid}`);
    return { target: "terminal", status: "dispatched", message: `Opened terminal in ${sanitizePath(rawCwd)} with --resume ${session.id}` };
  } catch (err) {
    return { target: "terminal", status: "failed", message: (err as Error).message };
  }
}

/** Open a plain terminal sitting in `dir` — no command, just an interactive shell (cross-platform) */
export function openTerminalInDir(dir: string): DelegationResult {
  try {
    spawnTerminalInDir(dir);
    return { target: "terminal", status: "dispatched", message: `Opened terminal in ${sanitizePath(dir || process.cwd())}` };
  } catch (err) {
    return { target: "terminal", status: "failed", message: (err as Error).message };
  }
}

/**
 * Delegate to Telegram bot — POST to the bot's HTTP API.
 * Configurable via TELEGRAM_BRIDGE_URL (e.g. http://127.0.0.1:5005); defaults to
 * a local bridge on :5005 and fails gracefully if no bridge is running.
 */
export async function delegateToTelegram(session: SessionData, task: string): Promise<DelegationResult> {
  const contextPrompt = buildContextPrompt(session);
  const fullMessage = task ? `${task}\n\nContext:\n${contextPrompt.slice(0, 2000)}` : contextPrompt.slice(0, 3000);

  let bridge: URL;
  try {
    bridge = new URL(process.env.TELEGRAM_BRIDGE_URL || "http://127.0.0.1:5005");
  } catch {
    return { target: "telegram", status: "failed", message: "Invalid TELEGRAM_BRIDGE_URL" };
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({ message: fullMessage, session_id: session.id });
    const req = http.request({
      hostname: bridge.hostname, port: bridge.port || 5005, method: "POST", path: "/api/send",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
      timeout: 5000,
    }, (res) => {
      res.resume();
      resolve({ target: "telegram", status: "dispatched", message: "Sent to Telegram bot", contextPrompt: fullMessage.slice(0, 500) });
    });
    req.on("error", () => {
      resolve({ target: "telegram", status: "failed", message: `Telegram bridge not reachable at ${bridge.origin} (set TELEGRAM_BRIDGE_URL)` });
    });
    req.on("timeout", () => { req.destroy(); resolve({ target: "telegram", status: "failed", message: "Telegram bot timed out" }); });
    req.write(postData);
    req.end();
  });
}

/** Delegate to voice — trigger outbound call (requires VOICE_CALLER_SCRIPT and VOICE_PHONE env vars) */
export function delegateToVoice(session: SessionData, task: string): DelegationResult {
  const script = process.env.VOICE_CALLER_SCRIPT;
  const phone = process.env.VOICE_PHONE;
  if (!script || !phone) {
    return { target: "voice", status: "failed", message: "Voice delegation not configured (set VOICE_CALLER_SCRIPT and VOICE_PHONE env vars)" };
  }

  const briefing = task || `Brief me on session: ${session.firstMessage?.slice(0, 60)}`;

  try {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.CLAUDECODE;
    const child = spawn("python", [script, "--phone", phone, "--task", briefing.slice(0, 200)], {
      detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv,
    });
    child.on("error", () => {});
    child.unref();
    return { target: "voice", status: "dispatched", message: "Outbound call initiated" };
  } catch (err) {
    return { target: "voice", status: "failed", message: (err as Error).message };
  }
}
