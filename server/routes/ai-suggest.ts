import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { spawn, execSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import type { CustomNode, CustomEdge, CustomNodeSubType } from "@shared/types";
import crypto from "crypto";

const router = Router();

/** Check if claude CLI is available and authenticated */
function checkClaudeCli(): { available: boolean; error?: string } {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    execSync("claude --version", { env, stdio: "pipe", timeout: 5000 });
    return { available: true };
  } catch (err: any) {
    const msg = err.message || "";
    if (msg.includes("not found") || msg.includes("not recognized") || msg.includes("ENOENT")) {
      return { available: false, error: "not_installed" };
    }
    return { available: false, error: "unknown" };
  }
}

/** Gather context about the current ecosystem for the AI */
function gatherContext(): string {
  const entities = storage.getEntities();
  const relationships = storage.getAllRelationships();
  const customNodes = storage.getCustomNodes();
  const customEdges = storage.getCustomEdges();

  const sections: string[] = [];

  // Entities summary with IDs for precise edge references
  const byType: Record<string, string[]> = {};
  for (const e of entities) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(`  - "${e.name}" (id: ${e.id}): ${e.description || "(no description)"}`);
  }
  for (const [type, items] of Object.entries(byType)) {
    sections.push(`## ${type.toUpperCase()} ENTITIES (${items.length})\n${items.join("\n")}`);
  }

  // Existing relationships with names
  if (relationships.length > 0) {
    const relLines = relationships.map((r) => {
      const src = entities.find((e) => e.id === r.sourceId);
      const tgt = entities.find((e) => e.id === r.targetId);
      return `  - "${src?.name || r.sourceId}" --[${r.relation}]--> "${tgt?.name || r.targetId}"`;
    });
    sections.push(`## EXISTING RELATIONSHIPS (${relationships.length})\n${relLines.join("\n")}`);
  }

  // Custom nodes already in graph — CRITICAL for avoiding duplicates
  if (customNodes.length > 0) {
    const nodeLines = customNodes.map((n) => `  - "${n.label}" (${n.subType}, id: ${n.id})`);
    sections.push(`## CUSTOM NODES ALREADY IN GRAPH — DO NOT SUGGEST THESE AGAIN\n${nodeLines.join("\n")}`);
  }

  // Custom edges already in graph (summarize to keep prompt short)
  if (customEdges.length > 0) {
    const edgeLines = customEdges.slice(0, 30).map((e) => {
      const srcNode = customNodes.find((n) => n.id === e.source);
      const srcEntity = entities.find((en) => en.id === e.source);
      const tgtNode = customNodes.find((n) => n.id === e.target);
      const tgtEntity = entities.find((en) => en.id === e.target);
      return `  - "${srcNode?.label || srcEntity?.name || e.source}" --[${e.label}]--> "${tgtNode?.label || tgtEntity?.name || e.target}"`;
    });
    if (customEdges.length > 30) edgeLines.push(`  ... and ${customEdges.length - 30} more edges`);
    sections.push(`## CUSTOM EDGES ALREADY IN GRAPH — DO NOT SUGGEST THESE AGAIN\n${edgeLines.join("\n")}`);
  }

  // CLAUDE.md content (if available) — this is the richest source of architecture info
  const home = os.homedir().replace(/\\/g, "/");
  const claudeMdPath = path.join(home, "CLAUDE.md");
  try {
    if (fs.statSync(claudeMdPath).isFile()) {
      const content = fs.readFileSync(claudeMdPath, "utf-8");
      sections.push(`## CLAUDE.md (home directory) — ARCHITECTURE REFERENCE\n${content.slice(0, 4000)}`);
    }
  } catch {}

  // MCP configs with env vars (for service detection)
  const mcps = entities.filter((e) => e.type === "mcp");
  if (mcps.length > 0) {
    const mcpDetails = mcps.map((m) => {
      const env = m.data.env as Record<string, string> | undefined;
      const envKeys = env ? Object.keys(env).join(", ") : "none";
      return `  - ${m.name}: ${m.data.transport || "stdio"}, env: [${envKeys}]`;
    });
    sections.push(`## MCP SERVER DETAILS\n${mcpDetails.join("\n")}`);
  }

  return sections.join("\n\n");
}

/** GET /api/graph/ai-suggest/status — Check if claude CLI is available */
router.get("/api/graph/ai-suggest/status", (_req: Request, res: Response) => {
  const result = checkClaudeCli();
  res.json(result);
});

router.post("/api/graph/ai-suggest", async (req: Request, res: Response) => {
  // Check claude CLI first
  const cliCheck = checkClaudeCli();
  if (!cliCheck.available) {
    return res.status(503).json({
      message: "Claude CLI not available",
      error: cliCheck.error,
      setup: true,
    });
  }

  const context = gatherContext();
  const existingEntities = storage.getEntities();
  const existingCustomNodes = storage.getCustomNodes();

  // Build a list of all existing names for the prompt
  const existingNames = [
    ...existingEntities.map((e) => e.name),
    ...existingCustomNodes.map((n) => n.label),
  ];

  const prompt = `You are analyzing a developer's Claude Code ecosystem to suggest additional nodes and edges for their dependency graph visualization.

Here is their current ecosystem:

${context}

RULES — follow these strictly:
1. DO NOT suggest nodes that duplicate existing entities or custom nodes. Check the lists above carefully.
   - If a project entity already represents something (e.g. "My App Docker" is the app), do NOT create a duplicate node for the same thing.
   - These names already exist and must NOT be duplicated: ${existingNames.slice(0, 50).join(", ")}
2. DO NOT suggest edges that already exist in the relationships or custom edges sections above.
3. Only suggest infrastructure/services that are clearly referenced in the data (CLAUDE.md, env vars, MCP configs).
4. For edge source/target, use EXACT entity names from the lists above (case-sensitive). For new nodes, use the new node's id.
5. Use specific relationship labels: connects_to, uses, depends_on, syncs_to, calls, reads_from, writes_to, deploys_to, monitors
6. Each edge must connect two DIFFERENT nodes. No self-referencing edges.
7. Prefer fewer, high-confidence suggestions over many uncertain ones.

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "nodes": [
    {
      "id": "kebab-case-id",
      "subType": "database|api|service|cicd|deploy|queue|cache|other",
      "label": "Human Readable Name",
      "description": "One sentence description",
      "color": "#hex"
    }
  ],
  "edges": [
    {
      "source": "exact entity name OR new node id",
      "target": "exact entity name OR new node id",
      "label": "relationship_type"
    }
  ],
  "reasoning": ["One reason per suggestion"]
}`;

  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", ["-p", "--model", "haiku", "--no-session-persistence"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to spawn claude CLI", error: err.message });
      }
    });

    const timeout = setTimeout(() => {
      child.kill();
    }, 300000); // 5 minutes — large ecosystems can take 2-3 min

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);

      console.log(`[ai-suggest] claude -p exited with code ${code}, stdout length: ${stdout.length}`);

      if (!stdout.trim()) {
        if (code !== 0) {
          console.error("[ai-suggest] claude -p failed with no output:", stderr.slice(0, 500));
          return res.status(500).json({ message: "AI suggestion failed", error: stderr.slice(0, 200) || `Exit code: ${code}` });
        }
        return res.status(500).json({ message: "AI returned empty response" });
      }

      try {
        let jsonStr = stdout.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        const suggestions = JSON.parse(jsonStr);

        // Build dedup sets from existing data
        const existingNodeLabels = new Set([
          ...existingEntities.map((e) => e.name.toLowerCase()),
          ...existingCustomNodes.map((n) => n.label.toLowerCase()),
        ]);
        const existingEdgeKeys = new Set([
          ...storage.getAllRelationships().map((r) => {
            const src = existingEntities.find((e) => e.id === r.sourceId)?.name || r.sourceId;
            const tgt = existingEntities.find((e) => e.id === r.targetId)?.name || r.targetId;
            return `${src.toLowerCase()}::${tgt.toLowerCase()}::${r.relation}`;
          }),
          ...storage.getCustomEdges().map((e) => {
            const srcNode = existingCustomNodes.find((n) => n.id === e.source);
            const srcEntity = existingEntities.find((en) => en.id === e.source);
            const tgtNode = existingCustomNodes.find((n) => n.id === e.target);
            const tgtEntity = existingEntities.find((en) => en.id === e.target);
            const srcName = srcNode?.label || srcEntity?.name || e.source;
            const tgtName = tgtNode?.label || tgtEntity?.name || e.target;
            return `${srcName.toLowerCase()}::${tgtName.toLowerCase()}::${e.label}`;
          }),
        ]);

        // Filter out duplicates
        const nodes: CustomNode[] = (suggestions.nodes || [])
          .filter((n: any) => {
            const label = String(n.label || "").toLowerCase();
            if (existingNodeLabels.has(label)) {
              console.log(`[ai-suggest] Skipping duplicate node: ${n.label}`);
              return false;
            }
            return label.length > 0;
          })
          .map((n: any) => ({
            id: `ai-${n.id || crypto.randomBytes(4).toString("hex")}`,
            subType: (["database", "api", "service", "cicd", "deploy", "queue", "cache", "other"].includes(n.subType) ? n.subType : "other") as CustomNodeSubType,
            label: String(n.label || "Unknown"),
            description: n.description ? String(n.description) : undefined,
            color: n.color ? String(n.color) : undefined,
            source: "ai-suggested" as const,
          }));

        const edges: CustomEdge[] = (suggestions.edges || [])
          .filter((e: any) => {
            if (!e.source || !e.target || !e.label) return false;
            if (String(e.source) === String(e.target)) return false; // no self-edges
            const key = `${String(e.source).toLowerCase()}::${String(e.target).toLowerCase()}::${String(e.label)}`;
            if (existingEdgeKeys.has(key)) {
              console.log(`[ai-suggest] Skipping duplicate edge: ${e.source} -> ${e.target} [${e.label}]`);
              return false;
            }
            return true;
          })
          .map((e: any) => ({
            id: `ai-edge-${crypto.randomBytes(4).toString("hex")}`,
            source: String(e.source || ""),
            target: String(e.target || ""),
            label: String(e.label || "connects_to"),
            source_origin: "ai-suggested" as const,
          }));

        res.json({
          nodes,
          edges,
          reasoning: suggestions.reasoning || [],
        });
      } catch (parseErr) {
        console.error("[ai-suggest] Failed to parse AI response:", stdout.slice(0, 500));
        res.status(500).json({ message: "Failed to parse AI suggestions" });
      }
    });
  } catch (err) {
    console.error("[ai-suggest] Error:", err);
    res.status(500).json({ message: "AI suggestion failed" });
  }
});

/** Accept selected AI suggestions and persist them */
router.post("/api/graph/ai-suggest/accept", (req: Request, res: Response) => {
  const { nodes, edges } = req.body as { nodes?: any[]; edges?: any[] };
  const validSubTypes = new Set(["service", "database", "api", "cicd", "deploy", "queue", "cache", "other"]);

  let acceptedNodes = 0;
  let acceptedEdges = 0;

  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (!n || typeof n.label !== "string" || !n.label) continue;
      const node: CustomNode = {
        id: (typeof n.id === "string" && n.id) ? n.id : `ai-${crypto.randomBytes(6).toString("hex")}`,
        subType: validSubTypes.has(n.subType) ? n.subType : "other",
        label: String(n.label).slice(0, 200),
        description: typeof n.description === "string" ? n.description.slice(0, 1000) : undefined,
        color: typeof n.color === "string" ? n.color.slice(0, 50) : undefined,
        source: "ai-suggested",
      };
      storage.upsertCustomNode(node);
      acceptedNodes++;
    }
  }

  if (Array.isArray(edges)) {
    for (const e of edges) {
      if (!e || typeof e.source !== "string" || typeof e.target !== "string" || typeof e.label !== "string") continue;
      const edge: CustomEdge = {
        id: `ai-edge-${crypto.randomBytes(6).toString("hex")}`,
        source: String(e.source).slice(0, 200),
        target: String(e.target).slice(0, 200),
        label: String(e.label).slice(0, 200),
        source_origin: "ai-suggested",
      };
      storage.upsertCustomEdge(edge);
      acceptedEdges++;
    }
  }

  res.json({ accepted: { nodes: acceptedNodes, edges: acceptedEdges } });
});

export default router;
