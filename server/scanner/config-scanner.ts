import type { Entity } from "@shared/types";
import { entityId, safeReadJson, getFileStat, CLAUDE_DIR, now, fileExists } from "./utils";
import path from "path";

function redactSecrets(obj: any, depth = 0): any {
  if (depth > 5) return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSecrets(v, depth + 1));

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lk = key.toLowerCase();
    if (lk.includes("secret") || lk.includes("password") || lk.includes("token") || lk.includes("key") || lk.includes("credential")) {
      result[key] = typeof value === "string" ? "***" : value;
    } else {
      result[key] = redactSecrets(value, depth + 1);
    }
  }
  return result;
}

export function scanConfigs(): Entity[] {
  const results: Entity[] = [];

  const configFiles = [
    { name: "settings.json", type: "settings" as const },
    { name: "settings.local.json", type: "settings-local" as const },
  ];

  for (const { name, type } of configFiles) {
    const filePath = path.join(CLAUDE_DIR, name).replace(/\\/g, "/");
    if (!fileExists(filePath)) continue;

    const json = safeReadJson(filePath);
    if (!json) continue;

    const stat = getFileStat(filePath);
    const redacted = redactSecrets(json);

    const id = entityId(`config:${filePath}`);
    results.push({
      id,
      type: "config",
      name,
      path: filePath,
      description: `Claude Code ${type} configuration`,
      lastModified: stat?.mtime ?? null,
      tags: [type],
      health: "ok",
      data: {
        configType: type,
        content: redacted,
      },
      scannedAt: now(),
    });
  }

  return results;
}
