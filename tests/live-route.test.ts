import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const tmpRoot = path.join(os.tmpdir(), "cc-live-route-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
fs.mkdirSync(tmpRoot, { recursive: true });
process.env.COMMAND_CENTER_DATA = path.join(tmpRoot, "data");

// Mock getLiveData so /api/live/close resolves PID server-side from a controllable
// fixture without scanning the real ~/.claude tree or spawning a kill.
const h = vi.hoisted(() => ({ sessions: [] as Array<{ sessionId: string; pid: number; kind?: string }> }));
vi.mock("../server/scanner/live-scanner", () => ({
  getLiveData: () => ({
    activeSessions: h.sessions,
    recentActivity: [],
    stats: { activeSessionCount: h.sessions.length, activeAgentCount: 0, agentsToday: 0, modelsInUse: [] },
  }),
}));

const express = (await import("express")).default;
const liveRouter = (await import("../server/routes/live")).default;
const { SHELL_NAMES } = await import("../server/routes/live");

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(liveRouter);
  return app;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const app = makeApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); return reject(new Error("no address")); }
      fetch(`http://127.0.0.1:${addr.port}${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => { const b = await res.json(); server.close(); resolve({ status: res.status, body: b }); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("SHELL_NAMES allowlist", () => {
  it("includes the shells whose exit closes a terminal tab", () => {
    for (const sh of ["cmd", "powershell", "pwsh", "bash", "zsh", "sh", "fish", "wsl"]) {
      expect(SHELL_NAMES.has(sh)).toBe(true);
    }
  });

  it("never includes terminal-host apps (killing those would close other tabs)", () => {
    for (const host of ["windowsterminal", "conhost", "terminal", "iterm2", "gnome-terminal", "alacritty", "wezterm"]) {
      expect(SHELL_NAMES.has(host)).toBe(false);
    }
  });
});

describe("POST /api/live/close — guard rails", () => {
  it("rejects a missing sessionId with 400", async () => {
    const res = await postJson("/api/live/close", {});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a non-UUID sessionId with 400", async () => {
    const res = await postJson("/api/live/close", { sessionId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session is not currently active", async () => {
    h.sessions = [];
    const res = await postJson("/api/live/close", { sessionId: VALID_UUID });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the active session has no resolvable PID", async () => {
    h.sessions = [{ sessionId: VALID_UUID, pid: 0 }];
    const res = await postJson("/api/live/close", { sessionId: VALID_UUID });
    expect(res.status).toBe(404);
  });
});
