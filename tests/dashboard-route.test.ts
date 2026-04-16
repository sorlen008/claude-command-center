import { describe, it, expect, vi } from "vitest";

vi.mock("../server/scanner/session-scanner", () => ({
  getCachedSessions: () => [],
}));

const express = (await import("express")).default;
const dashboardRouter = (await import("../server/routes/dashboard-analytics")).default;

async function request(app: ReturnType<typeof express>, url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }
      const port = addr.port;
      fetch(`http://127.0.0.1:${port}${url}`)
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("GET /api/analytics/dashboard", () => {
  it("defaults to 30d when range omitted", async () => {
    const app = express();
    app.use(dashboardRouter);
    const res = await request(app, "/api/analytics/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.header.range).toBe("30d");
    expect(res.body.header.rangeLabel).toBe("Last 30 Days");
  });

  it("accepts each valid range", async () => {
    const app = express();
    app.use(dashboardRouter);
    for (const r of ["today", "7d", "30d", "month", "all"] as const) {
      const res = await request(app, `/api/analytics/dashboard?range=${r}`);
      expect(res.status).toBe(200);
      expect(res.body.header.range).toBe(r);
    }
  });

  it("rejects invalid range with 400", async () => {
    const app = express();
    app.use(dashboardRouter);
    const res = await request(app, "/api/analytics/dashboard?range=forever");
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Invalid range");
  });
});
