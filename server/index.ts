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
