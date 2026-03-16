import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { getCachedDefinitions, getCachedExecutions, getCachedAgentStats } from "../scanner/agent-scanner";
import { CLAUDE_DIR, entityId, dirExists, fileExists, readMessageTimeline } from "../scanner/utils";
import { qstr, validate, AgentExecListSchema, validateMarkdownPath } from "./validation";

const router = Router();

/** Build a map of agent name → most recent execution timestamp.
 *  Matches execution agentType to definition names. */
function getLastUsedMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const exec of getCachedExecutions()) {
    const ts = exec.lastTs || exec.firstTs;
    if (!ts) continue;
    // Store by agentType (e.g. "Explore", "Plan", "general-purpose")
    if (exec.agentType) {
      const existing = map.get(exec.agentType);
      if (!existing || ts > existing) {
        map.set(exec.agentType, ts);
      }
    }
  }
  return map;
}

/** GET /api/agents/definitions — All agent definitions */
router.get("/api/agents/definitions", (_req: Request, res: Response) => {
  const lastUsed = getLastUsedMap();
  const defs = getCachedDefinitions().map(def => ({
    ...def,
    lastUsed: lastUsed.get(def.name) || null,
  }));
  res.json(defs);
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
  if (content.length > 100_000) return res.status(400).json({ message: "content too long (max 100KB)" });

  // Validate path is under home directory
  const safePath = validateMarkdownPath(def.filePath);
  if (!safePath) return res.status(403).json({ message: "Path must be under user home directory" });

  try {
    fs.writeFileSync(safePath, content, "utf-8");
    res.json({ message: "Updated", id: def.id });
  } catch (err) {
    console.error("[agents] Failed to update agent:", (err as Error).message);
    res.status(500).json({ message: (err as Error).message });
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

  if (!name || typeof name !== "string") return res.status(400).json({ message: "name required" });
  if (name.length > 100) return res.status(400).json({ message: "name too long (max 100)" });
  if (description && description.length > 500) return res.status(400).json({ message: "description too long (max 500)" });
  if (content && content.length > 100_000) return res.status(400).json({ message: "content too long (max 100KB)" });

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
  } catch (err) {
    console.error("[agents] Failed to create agent:", (err as Error).message);
    res.status(500).json({ message: (err as Error).message });
  }
});

/** GET /api/agents/executions — List with filters */
router.get("/api/agents/executions", (req: Request, res: Response) => {
  const params = validate(AgentExecListSchema, {
    type: qstr(req.query.type),
    sessionId: qstr(req.query.sessionId),
    q: qstr(req.query.q),
    sort: qstr(req.query.sort),
    order: qstr(req.query.order),
    limit: qstr(req.query.limit),
  }, res);
  if (!params) return;

  const { type, sessionId, q, sort, order, limit } = params;

  let executions = getCachedExecutions();

  if (type) executions = executions.filter(e => e.agentType === type);
  if (sessionId) executions = executions.filter(e => e.sessionId === sessionId);
  if (q) {
    const lowerQ = q.toLowerCase();
    executions = executions.filter(e => {
      const haystack = [e.firstMessage, e.slug, e.agentType || "", e.model || "", e.agentId].join(" ").toLowerCase();
      return haystack.includes(lowerQ);
    });
  }

  const asc = order === "asc";
  executions = [...executions].sort((a, b) => {
    let av: string | number, bv: string | number;
    if (sort === "firstTs") { av = a.firstTs || ""; bv = b.firstTs || ""; }
    else if (sort === "lastTs") { av = a.lastTs || ""; bv = b.lastTs || ""; }
    else if (sort === "sizeBytes") { av = a.sizeBytes; bv = b.sizeBytes; }
    else if (sort === "messageCount") { av = a.messageCount; bv = b.messageCount; }
    else { av = a.firstTs || ""; bv = b.firstTs || ""; }
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });

  executions = executions.slice(0, limit);

  res.json(executions);
});

/** GET /api/agents/executions/:agentId — Detail with message timeline */
router.get("/api/agents/executions/:agentId", (req: Request, res: Response) => {
  const exec = getCachedExecutions().find(e => e.agentId === req.params.agentId);
  if (!exec) return res.status(404).json({ message: "Execution not found" });

  const records = readMessageTimeline(exec.filePath, { includeModel: true });

  res.json({ ...exec, records });
});

/** GET /api/agents/stats — Aggregate stats */
router.get("/api/agents/stats", (_req: Request, res: Response) => {
  res.json(getCachedAgentStats());
});

export default router;
