import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { getCachedDefinitions, getCachedExecutions, getCachedAgentStats } from "../scanner/agent-scanner";
import { CLAUDE_DIR, entityId, dirExists, fileExists } from "../scanner/utils";

const router = Router();

function qstr(v: unknown): string | undefined {
  return Array.isArray(v) ? (v[0] as string) : (v as string | undefined);
}

/** GET /api/agents/definitions — All agent definitions */
router.get("/api/agents/definitions", (_req: Request, res: Response) => {
  res.json(getCachedDefinitions());
});

/** GET /api/agents/definitions/:id — Single definition with full content */
router.get("/api/agents/definitions/:id", (req: Request, res: Response) => {
  const def = getCachedDefinitions().find(d => d.id === req.params.id);
  if (!def) return res.status(404).json({ message: "Definition not found" });

  // Re-read full content for detail view
  try {
    const raw = fs.readFileSync(def.filePath, "utf-8");
    const parsed = matter(raw);
    res.json({ ...def, content: parsed.content.trim() });
  } catch {
    res.json(def);
  }
});

/** PUT /api/agents/definitions/:id — Update writable agent */
router.put("/api/agents/definitions/:id", (req: Request, res: Response) => {
  const def = getCachedDefinitions().find(d => d.id === req.params.id);
  if (!def) return res.status(404).json({ message: "Definition not found" });
  if (!def.writable) return res.status(403).json({ message: "Plugin agents are read-only" });

  const { content } = req.body as { content?: string };
  if (typeof content !== "string") return res.status(400).json({ message: "content required" });

  try {
    fs.writeFileSync(def.filePath, content, "utf-8");
    res.json({ message: "Updated", id: def.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/** POST /api/agents/definitions — Create user agent */
router.post("/api/agents/definitions", (req: Request, res: Response) => {
  const { name, description, model, color, tools, content } = req.body as {
    name?: string;
    description?: string;
    model?: string;
    color?: string;
    tools?: string[];
    content?: string;
  };

  if (!name) return res.status(400).json({ message: "name required" });

  const agentsDir = path.join(CLAUDE_DIR, "agents").replace(/\\/g, "/");
  if (!dirExists(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const filePath = path.join(agentsDir, `${slug}.md`).replace(/\\/g, "/");
  if (fileExists(filePath)) {
    return res.status(409).json({ message: "Agent with that name already exists" });
  }

  const frontmatter: Record<string, unknown> = { name };
  if (description) frontmatter.description = description;
  if (model && model !== "inherit") frontmatter.model = model;
  if (color) frontmatter.color = color;
  if (tools && tools.length > 0) frontmatter.tools = tools.join(", ");

  const fileContent = matter.stringify(content || "", frontmatter);

  try {
    fs.writeFileSync(filePath, fileContent, "utf-8");
    res.json({ message: "Created", id: entityId(filePath), filePath });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/** GET /api/agents/executions — List with filters */
router.get("/api/agents/executions", (req: Request, res: Response) => {
  const type = qstr(req.query.type);
  const sessionId = qstr(req.query.sessionId);
  const q = qstr(req.query.q)?.toLowerCase();
  const sort = qstr(req.query.sort) || "firstTs";
  const order = qstr(req.query.order) || "desc";
  const limit = parseInt(qstr(req.query.limit) || "100", 10);

  let executions = getCachedExecutions();

  if (type) executions = executions.filter(e => e.agentType === type);
  if (sessionId) executions = executions.filter(e => e.sessionId === sessionId);
  if (q) {
    executions = executions.filter(e => {
      const haystack = [e.firstMessage, e.slug, e.agentType || "", e.model || "", e.agentId].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  const asc = order === "asc";
  executions = [...executions].sort((a, b) => {
    let av: any, bv: any;
    if (sort === "firstTs") { av = a.firstTs || ""; bv = b.firstTs || ""; }
    else if (sort === "lastTs") { av = a.lastTs || ""; bv = b.lastTs || ""; }
    else if (sort === "sizeBytes") { av = a.sizeBytes; bv = b.sizeBytes; }
    else if (sort === "messageCount") { av = a.messageCount; bv = b.messageCount; }
    else { av = a.firstTs || ""; bv = b.firstTs || ""; }
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });

  executions = executions.slice(0, Math.min(limit, 1000));

  res.json(executions);
});

/** GET /api/agents/executions/:agentId — Detail with message timeline */
router.get("/api/agents/executions/:agentId", (req: Request, res: Response) => {
  const exec = getCachedExecutions().find(e => e.agentId === req.params.agentId);
  if (!exec) return res.status(404).json({ message: "Execution not found" });

  const records: { type: string; role?: string; timestamp: string; contentPreview: string; model?: string }[] = [];
  try {
    const stat = fs.statSync(exec.filePath);
    const chunkSize = Math.min(131072, stat.size);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(exec.filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n");
    let count = 0;
    for (let i = 0; i < Math.min(lines.length, 150) && count < 50; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.type === "user" || r.type === "assistant") {
          const msg = r.message;
          let preview = "";
          if (msg && typeof msg === "object") {
            const c = msg.content;
            if (typeof c === "string") preview = c;
            else if (Array.isArray(c)) {
              preview = c.filter((x: any) => x?.type === "text").map((x: any) => x.text || "").join(" ");
            }
          }
          records.push({
            type: r.type,
            role: msg?.role,
            timestamp: r.timestamp || "",
            contentPreview: preview.replace(/\n/g, " ").slice(0, 300),
            model: r.type === "assistant" ? msg?.model : undefined,
          });
          count++;
        }
      } catch {}
    }
  } catch {}

  res.json({ ...exec, records });
});

/** GET /api/agents/stats — Aggregate stats */
router.get("/api/agents/stats", (_req: Request, res: Response) => {
  res.json(getCachedAgentStats());
});

export default router;
