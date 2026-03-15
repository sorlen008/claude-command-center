import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { runFullScan, isScanning, getScanVersion, getLastScanDuration, addSSEClient } from "../scanner/index";

const router = Router();

router.post("/api/scanner/rescan", async (_req: Request, res: Response) => {
  if (isScanning()) {
    return res.status(409).json({ message: "Scan already in progress" });
  }
  await runFullScan();
  res.json({ message: "Scan complete", status: storage.getScanStatus() });
});

router.get("/api/scanner/status", (_req: Request, res: Response) => {
  const status = storage.getScanStatus();
  status.scanning = isScanning();
  res.json({
    ...status,
    scanVersion: getScanVersion(),
    lastScanDuration: getLastScanDuration(),
  });
});

// SSE endpoint — pushes scan events to connected clients
router.get("/api/scanner/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial state
  const status = storage.getScanStatus();
  res.write(`event: connected\ndata: ${JSON.stringify({
    scanVersion: getScanVersion(),
    totalEntities: status.totalEntities,
  })}\n\n`);

  // Keep alive every 30s
  const keepAlive = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 30000);

  // Register for scan events
  const remove = addSSEClient((data: string) => {
    res.write(data);
  });

  req.on("close", () => {
    clearInterval(keepAlive);
    remove();
  });
});

export default router;
