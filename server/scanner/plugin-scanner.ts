import type { Entity } from "@shared/types";
import { entityId, safeReadJson, getFileStat, CLAUDE_DIR, now, dirExists, fileExists } from "./utils";
import { PLUGIN_CATALOG } from "./knowledge-base";
import path from "path";
import fs from "fs";

export function scanPlugins(): Entity[] {
  const results: Entity[] = [];
  const pluginsDir = path.join(CLAUDE_DIR, "plugins").replace(/\\/g, "/");

  // Parse blocklist
  const blocklist: Record<string, { reason: string; text: string }> = {};
  const blocklistPath = path.join(pluginsDir, "blocklist.json").replace(/\\/g, "/");
  const blocklistJson = safeReadJson(blocklistPath);
  if (blocklistJson?.plugins) {
    for (const entry of blocklistJson.plugins) {
      blocklist[entry.plugin] = { reason: entry.reason, text: entry.text };
    }
  }

  // Parse known marketplaces
  const marketplacesPath = path.join(pluginsDir, "known_marketplaces.json").replace(/\\/g, "/");
  const marketplacesJson = safeReadJson(marketplacesPath);

  if (marketplacesJson) {
    for (const [marketplaceId, config] of Object.entries(marketplacesJson as Record<string, any>)) {
      const installLocation = config.installLocation?.replace(/\\/g, "/");
      const stat = installLocation ? getFileStat(installLocation) : null;

      // Check if marketplace dir has plugins
      const mktDir = path.join(pluginsDir, "marketplaces", marketplaceId).replace(/\\/g, "/");
      let pluginDirs: string[] = [];
      if (dirExists(mktDir)) {
        try {
          pluginDirs = fs
            .readdirSync(mktDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name !== ".git" && d.name !== ".claude-plugin")
            .map((d) => d.name);
        } catch {}
      }

      // Create entity for marketplace itself
      const mktId = entityId(`plugin:marketplace:${marketplaceId}`);
      results.push({
        id: mktId,
        type: "plugin",
        name: marketplaceId,
        path: mktDir,
        description: `Plugin marketplace from ${config.source?.repo || "unknown"}`,
        lastModified: config.lastUpdated || null,
        tags: ["marketplace"],
        health: "ok",
        data: {
          marketplace: marketplaceId,
          installed: true,
          blocked: false,
          hasMCP: false,
        },
        scannedAt: now(),
      });

      // Create entities for individual plugins within marketplace
      for (const pluginName of pluginDirs) {
        const pluginKey = `${pluginName}@${marketplaceId}`;
        const isBlocked = pluginKey in blocklist;
        const pluginPath = path.join(mktDir, pluginName).replace(/\\/g, "/");
        const hasMcp = fileExists(path.join(pluginPath, ".mcp.json"));

        const id = entityId(`plugin:${pluginKey}`);
        const catalog = PLUGIN_CATALOG[pluginName];
        const pluginTags = isBlocked ? ["blocked"] : [];
        if (catalog && !isBlocked) pluginTags.push(catalog.category);

        results.push({
          id,
          type: "plugin",
          name: pluginName,
          path: pluginPath,
          description: isBlocked ? `Blocked: ${blocklist[pluginKey].reason}` : (catalog?.description ?? null),
          lastModified: null,
          tags: pluginTags,
          health: isBlocked ? "warning" : "ok",
          data: {
            marketplace: marketplaceId,
            installed: true,
            blocked: isBlocked,
            blockReason: isBlocked ? blocklist[pluginKey].reason : undefined,
            hasMCP: hasMcp,
            category: catalog?.category,
          },
          scannedAt: now(),
        });
      }
    }
  }

  // Blocklist entries that aren't in any marketplace
  for (const pluginKey of Object.keys(blocklist)) {
    const existingId = entityId(`plugin:${pluginKey}`);
    if (!results.find((r) => r.id === existingId)) {
      results.push({
        id: existingId,
        type: "plugin",
        name: pluginKey.split("@")[0],
        path: pluginsDir,
        description: `Blocked: ${blocklist[pluginKey].reason}`,
        lastModified: null,
        tags: ["blocked"],
        health: "warning",
        data: {
          marketplace: pluginKey.split("@")[1] || null,
          installed: false,
          blocked: true,
          blockReason: blocklist[pluginKey].reason,
          hasMCP: false,
        },
        scannedAt: now(),
      });
    }
  }

  return results;
}
