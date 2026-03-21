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

/** Sanitize a path for safe shell interpolation */
function sanitizePath(p: string): string {
  // Remove any shell metacharacters except path separators, spaces, dots, hyphens
  return p.replace(/[^a-zA-Z0-9\s/\\:._\-]/g, "");
}

/** Delegate to terminal — opens a new terminal with claude --resume in the session's cwd (cross-platform) */
export function delegateToTerminal(session: SessionData): DelegationResult {
  try {
    const env = { ...process.env, CLAUDECODE: undefined };
    const plat = process.platform;
    const rawCwd = session.cwd || process.cwd();
    const cwd = sanitizePath(rawCwd);
    const sid = session.id.replace(/[^a-f0-9-]/gi, ""); // UUID chars only
    let child;
    if (plat === "win32") {
      const winCwd = rawCwd.replace(/\//g, "\\");
      child = spawn(`start "Claude" cmd /k "cd /d ${winCwd} && claude --resume ${sid}"`, [], {
        detached: true, stdio: "ignore", shell: true, env: env as NodeJS.ProcessEnv,
      });
    } else if (plat === "darwin") {
      const safeCwd = cwd.replace(/'/g, "'\\''");
      child = spawn("osascript", ["-e", `tell application "Terminal" to do script "cd '${safeCwd}' && claude --resume ${sid}"`], {
        detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv,
      });
    } else {
      const safeCwd = cwd.replace(/'/g, "'\\''");
      child = spawn("x-terminal-emulator", ["-e", "bash", "-c", `cd '${safeCwd}' && claude --resume ${sid}`], {
        detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv,
      });
    }
    child.on("error", () => {});
    child.unref();
    return { target: "terminal", status: "dispatched", message: `Opened terminal in ${cwd} with --resume ${session.id}` };
  } catch (err) {
    return { target: "terminal", status: "failed", message: (err as Error).message };
  }
}

/** Delegate to Telegram bot — POST to the bot's HTTP API */
export async function delegateToTelegram(session: SessionData, task: string): Promise<DelegationResult> {
  const contextPrompt = buildContextPrompt(session);
  const fullMessage = task ? `${task}\n\nContext:\n${contextPrompt.slice(0, 2000)}` : contextPrompt.slice(0, 3000);

  return new Promise((resolve) => {
    const postData = JSON.stringify({ message: fullMessage, session_id: session.id });
    const req = http.request({
      hostname: "127.0.0.1", port: 5005, method: "POST", path: "/api/send",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
      timeout: 5000,
    }, (res) => {
      res.resume();
      resolve({ target: "telegram", status: "dispatched", message: "Sent to Telegram bot", contextPrompt: fullMessage.slice(0, 500) });
    });
    req.on("error", () => {
      resolve({ target: "telegram", status: "failed", message: "Telegram bot HTTP API not available on :5005" });
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
