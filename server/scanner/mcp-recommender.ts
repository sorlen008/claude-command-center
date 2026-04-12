import { MCP_CATALOG } from "./knowledge-base";
import { storage } from "../storage";

/** Tech stack → relevant MCP names mapping */
const STACK_MCP_MAP: Record<string, string[]> = {
  // JavaScript / TypeScript ecosystem
  "react": ["figma", "vercel", "stitch", "21st-dev"],
  "next": ["vercel", "supabase", "stripe"],
  "express": ["docker", "datadog", "sentry"],
  "vue": ["figma", "vercel"],
  "svelte": ["vercel"],
  "typescript": ["github", "context7"],
  "node": ["docker", "datadog", "redis"],

  // Python ecosystem
  "python": ["docker", "aws", "datadog"],
  "django": ["postgres", "redis", "sentry"],
  "fastapi": ["docker", "postgres", "redis"],
  "flask": ["docker", "postgres"],

  // Databases
  "postgresql": ["postgres", "supabase"],
  "postgres": ["postgres", "supabase"],
  "mongodb": ["mongodb"],
  "redis": ["redis"],
  "firebase": ["firebase"],
  "supabase": ["supabase"],

  // DevOps / Cloud
  "docker": ["docker", "aws", "datadog"],
  "aws": ["aws"],
  "vercel": ["vercel"],

  // Communication
  "slack": ["slack"],
  "discord": ["discord"],
  "telegram": ["telegram"],
  "twilio": ["twilio"],

  // Project management
  "jira": ["jira"],
  "linear": ["linear"],
  "notion": ["notion"],
  "airtable": ["airtable"],

  // E-commerce
  "shopify": ["shopify"],
  "stripe": ["stripe"],
};

export interface MCPRecommendation {
  name: string;
  category: string;
  description: string;
  reason: string;
  capabilities: string[];
  website?: string;
  alreadyInstalled: boolean;
}

/**
 * Generate MCP recommendations based on detected tech stacks across all projects.
 * Uses existing cached entity data — no filesystem scanning needed.
 */
export function getRecommendations(): MCPRecommendation[] {
  const entities = storage.getEntities();
  const projects = entities.filter(e => e.type === "project");
  const installedMcps = new Set(entities.filter(e => e.type === "mcp").map(e => e.name.toLowerCase()));

  // Collect all tech stack keywords from all projects
  const allTech = new Set<string>();
  for (const p of projects) {
    const stack = (p.data?.techStack as string[]) || [];
    for (const tech of stack) {
      allTech.add(tech.toLowerCase());
    }
    // Also check project name for hints
    const name = p.name.toLowerCase();
    for (const key of Object.keys(STACK_MCP_MAP)) {
      if (name.includes(key)) allTech.add(key);
    }
  }

  // Score MCPs by how many tech stack matches they have
  const mcpScores = new Map<string, { score: number; reasons: string[] }>();

  for (const tech of Array.from(allTech)) {
    const mcps = STACK_MCP_MAP[tech] || [];
    for (const mcpName of mcps) {
      if (!MCP_CATALOG[mcpName]) continue;
      const entry = mcpScores.get(mcpName) || { score: 0, reasons: [] };
      entry.score++;
      entry.reasons.push(tech);
      mcpScores.set(mcpName, entry);
    }
  }

  // Build recommendations sorted by score
  const recommendations: MCPRecommendation[] = [];
  const sorted = Array.from(mcpScores.entries()).sort((a, b) => b[1].score - a[1].score);

  for (const [name, { score, reasons }] of sorted) {
    const catalog = MCP_CATALOG[name];
    if (!catalog) continue;
    const isInstalled = installedMcps.has(name);
    const uniqueReasons = Array.from(new Set(reasons)).slice(0, 3);

    recommendations.push({
      name,
      category: catalog.category,
      description: catalog.description,
      reason: `Matches your ${uniqueReasons.join(", ")} stack`,
      capabilities: catalog.capabilities,
      website: catalog.website,
      alreadyInstalled: isInstalled,
    });
  }

  return recommendations.slice(0, 10);
}
