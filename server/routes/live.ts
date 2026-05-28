import { Router, type Request, type Response } from "express";
import { spawn, spawnSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getLiveData } from "../scanner/live-scanner";
import { storage } from "../storage";

const router = Router();

/** GET /api/live — Full live data bundle */
router.get("/api/live", (_req: Request, res: Response) => {
  const data = getLiveData();
  const titles = storage.getTitles();
  const annotated = {
    ...data,
    activeSessions: data.activeSessions.map(s => ({
      ...s,
      customName: titles[s.sessionId] || undefined,
    })),
  };
  res.json(annotated);
});

/**
 * POST /api/live/compact — Inject /compact into the terminal window running the given session.
 * Windows only. Walks the parent process chain from the Claude PID via WMI to find the first
 * ancestor with an activatable window (usually WindowsTerminal.exe), calls AppActivate on it,
 * then SendKeys "/compact{ENTER}". With multiple Windows Terminal tabs, SendKeys targets the
 * last-active tab — ensure the correct tab was focused before clicking the button.
 */
router.post("/api/live/compact", (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId || typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ success: false, message: "invalid sessionId" });
  }

  const liveData = getLiveData();
  const session = liveData.activeSessions.find(s => s.sessionId === sessionId);
  if (!session || !session.pid) {
    return res.status(404).json({ success: false, message: "Session not found in active sessions" });
  }

  if (process.platform !== "win32") {
    return res.json({ success: false, platform: false, message: "Keyboard injection is only supported on Windows" });
  }

  const tmpFile = join(tmpdir(), `cc-compact-${Date.now()}.ps1`);
  const psScript = [
    `$targetPid = ${session.pid}`,
    `$wsh = New-Object -ComObject WScript.Shell`,
    ``,
    `function Get-ParPid([int]$p) {`,
    `    try { return [int](Get-WmiObject -Class Win32_Process -Filter "ProcessId=$p" -ErrorAction Stop).ParentProcessId } catch { return 0 }`,
    `}`,
    ``,
    `$current = Get-ParPid $targetPid`,
    `$trace = @()`,
    `for ($i = 0; $i -lt 6 -and $current -gt 0; $i++) {`,
    `    $procName = try { (Get-Process -Id $current -ErrorAction Stop).ProcessName } catch { "?" }`,
    `    $activated = try { $wsh.AppActivate([int]$current) } catch { $false }`,
    `    $trace += "pid=$current name=$procName act=$activated"`,
    `    if ($activated) {`,
    `        Write-Output "ok:$current"`,
    `        Write-Output ("trace:" + ($trace -join " | "))`,
    `        Start-Sleep -Milliseconds 500`,
    `        $wsh.SendKeys("/compact{ENTER}")`,
    `        exit 0`,
    `    }`,
    `    $current = Get-ParPid $current`,
    `}`,
    `Write-Output "fail"`,
    `Write-Output ("trace:" + ($trace -join " | "))`,
    `exit 1`,
  ].join("\r\n");

  try {
    writeFileSync(tmpFile, psScript, "utf8");
  } catch {
    return res.json({ success: false, message: "Could not write temp script" });
  }

  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpFile], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

  const killTimer = setTimeout(() => { try { child.kill(); } catch {} }, 8000);

  const cleanup = () => { try { unlinkSync(tmpFile); } catch {} };

  child.on("close", (code) => {
    clearTimeout(killTimer);
    cleanup();
    const out = stdout.trim();
    if (code === 0 && /(^|\r?\n)ok:/.test(out)) {
      res.json({ success: true, message: "/compact sent to terminal" });
    } else {
      res.json({ success: false, debug: { code, out, err: stderr.trim().slice(0, 400), pid: session.pid } });
    }
  });

  child.on("error", (e) => {
    clearTimeout(killTimer);
    cleanup();
    res.json({ success: false, debug: { code: -1, out: "", err: e.message, pid: session.pid } });
  });
});

// Shells we're willing to kill to close an interactive session's terminal
// window/tab. We deliberately do NOT kill terminal-host apps (WindowsTerminal,
// conhost, Terminal, iTerm2, gnome-terminal) — those host other tabs/windows.
const SHELL_NAMES = new Set([
  "cmd", "powershell", "pwsh", "bash", "wsl", "sh", "zsh", "fish", "dash", "ash", "nu",
  "cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "wsl.exe",
]);

/**
 * POST /api/live/close — End a session AND close its terminal window.
 *
 * Kills the running Claude process; for an interactive session it kills the
 * PARENT SHELL (cmd/pwsh/bash/zsh/…) instead, because a terminal tab/window
 * closes when its shell exits. It never kills the terminal-host app itself
 * (that would close all your other tabs). Background (headless) sessions have
 * no window, so only the process is killed. Cross-platform (best-effort: some
 * terminals keep the window per user preference). The transcript is KEPT —
 * still browsable and resumable. PID is resolved server-side, never trusted
 * from the client.
 */
router.post("/api/live/close", (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId || typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ success: false, message: "invalid sessionId" });
  }

  const session = getLiveData().activeSessions.find(s => s.sessionId === sessionId);
  if (!session || !session.pid) {
    return res.status(404).json({ success: false, message: "Session not found in active sessions" });
  }
  const pid = session.pid;
  const isBg = session.kind === "bg";  // headless — no window to close

  if (process.platform === "win32") {
    // For interactive sessions, walk one level up: if Claude's parent is a
    // shell, kill that shell's tree (closes the tab); otherwise kill Claude's
    // tree. taskkill /T only kills descendants, so the terminal host (an
    // ancestor) is never touched.
    const psLines = isBg
      ? [`taskkill /PID ${pid} /T /F | Out-Null; Write-Output "proc:${pid}"`]
      : [
          `$cpid=${pid}`,
          `$shells='cmd','powershell','pwsh','bash','wsl','sh','zsh','fish'`,
          `$par=try{(Get-CimInstance Win32_Process -Filter "ProcessId=$cpid" -EA Stop).ParentProcessId}catch{0}`,
          `$pname=try{(Get-Process -Id $par -EA Stop).ProcessName.ToLower()}catch{''}`,
          `if($par -gt 0 -and ($shells -contains $pname)){ taskkill /PID $par /T /F | Out-Null; Write-Output "shell:$par" }`,
          `else { taskkill /PID $cpid /T /F | Out-Null; Write-Output "proc:$cpid" }`,
        ];
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psLines.join("; ")], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = ""; let err = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, 8000);
    child.on("close", () => {
      clearTimeout(t);
      const closedWindow = out.includes("shell:");
      res.json({ success: true, pid, closedWindow, message: `Ended session (pid ${pid})${closedWindow ? " and closed its window" : ""}. Transcript kept.`, detail: (out + err).trim().slice(0, 200) });
    });
    child.on("error", (e) => { clearTimeout(t); res.status(500).json({ success: false, message: e.message, pid }); });
    return;
  }

  // macOS / Linux — find the parent shell via ps; kill it (closes the
  // tab/window) plus the Claude process, else just the Claude process.
  try {
    let target = pid;
    if (!isBg) {
      const ppidStr = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).stdout?.trim() || "";
      const ppid = parseInt(ppidStr, 10);
      if (ppid && ppid > 1) {
        const comm = (spawnSync("ps", ["-o", "comm=", "-p", String(ppid)], { encoding: "utf8" }).stdout || "").trim();
        const base = (comm.split("/").pop() || "").replace(/^-/, "");
        if (SHELL_NAMES.has(base)) target = ppid;
      }
    }
    if (target !== pid) { try { process.kill(pid, "SIGKILL"); } catch {} }  // ensure Claude dies too
    process.kill(target, target !== pid ? "SIGKILL" : "SIGTERM");
    const closedWindow = target !== pid;
    res.json({ success: true, pid, closedWindow, message: `Ended session (pid ${pid})${closedWindow ? " and closed its window" : ""}. Transcript kept.` });
  } catch (e) {
    res.status(500).json({ success: false, message: (e as Error).message, pid });
  }
});

export default router;
