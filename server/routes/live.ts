import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
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

export default router;
