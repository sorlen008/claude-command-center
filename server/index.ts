import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runFullScan } from "./scanner/index";
import { startWatcher } from "./scanner/watcher";
import { storage } from "./storage";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// CLI mode: handle --report and --audit without starting the server
const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--report")) {
  const jsonMode = cliArgs.includes("--json");
  import("./cli/report").then(m => m.runReport(jsonMode)).catch(err => { console.error(err.message); process.exit(1); });
} else if (cliArgs.includes("--audit")) {
  const jsonMode = cliArgs.includes("--json");
  import("./cli/audit").then(m => m.runAudit(jsonMode)).catch(err => { console.error(err.message); process.exit(1); });
} else {
  // Server mode — start the web dashboard

  // Crash-logging only — keep the single-process dashboard alive when a stray
  // rejection or an escaped event-callback error (e.g. a double res.json) would
  // otherwise take it down. We log and continue rather than exit; we do NOT use
  // the resume-after-uncaughtException anti-pattern for normal control flow.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });

  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  // --- Localhost trust boundary -------------------------------------------
  // This dashboard reads private session data and exposes process-spawning,
  // file-writing, and self-update endpoints. It's meant to run on loopback, so:
  //  - reject requests whose Host header isn't a local name (blocks DNS-rebinding
  //    attacks that bypass the loopback bind), and
  //  - reject cross-site state-changing requests via an Origin allowlist
  //    (lightweight CSRF defense — no token needed for a same-origin app).
  // Requests with no Origin (same-origin fetch, curl, the watchdog's
  // Invoke-WebRequest) are allowed. Set COMMAND_CENTER_ALLOWED_HOSTS
  // (comma-separated hostnames) only if you intentionally expose it on a LAN.
  const ALLOWED_HOSTS = new Set<string>([
    "localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0",
    ...(process.env.COMMAND_CENTER_ALLOWED_HOSTS || "")
      .split(",").map(h => h.trim().toLowerCase()).filter(Boolean),
  ]);
  const hostnameOf = (hostHeader: string | undefined): string => {
    if (!hostHeader) return "";
    // strip port; handle bracketed IPv6
    const h = hostHeader.trim().toLowerCase();
    if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
    return h.split(":")[0];
  };
  app.use((req, res, next) => {
    const host = hostnameOf(req.headers.host);
    if (host && !ALLOWED_HOSTS.has(host)) {
      return res.status(403).json({ message: "Forbidden: this dashboard only accepts local connections." });
    }
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = "";
        try { originHost = new URL(origin).hostname.toLowerCase(); } catch { originHost = "<invalid>"; }
        if (!ALLOWED_HOSTS.has(originHost)) {
          return res.status(403).json({ message: "Forbidden: cross-origin request blocked." });
        }
      }
    }
    next();
  });

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith("/api")) {
        let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse && !reqPath.includes("content")) {
          const str = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${str.length > 200 ? str.slice(0, 200) + "..." : str}`;
        }
        log(logLine);
      }
    });

    next();
  });

  (async () => {
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (res.headersSent) return next(err);
      return res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5100", 10);
    const host = process.env.HOST || "127.0.0.1";
    httpServer.listen({ port, host }, () => {
      log(`${storage.getAppSettings().appName} serving on port ${port}`);
    });

    // Run initial scan and start watcher
    await runFullScan();
    startWatcher();
  })().catch((err) => {
    // A malformed ~/.claude JSONL (parsed during runFullScan) or any boot
    // failure must not silently hang — log it loudly.
    console.error("[startup] Fatal error during server startup:", err);
  });
}
