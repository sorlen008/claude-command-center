import type { Entity } from "@shared/types";
import { entityId, safeReadJson, getFileStat, CLAUDE_DIR, now, dirExists, fileExists, getExtraPaths, normPath } from "./utils";
import { PLUGIN_CATALOG } from "./knowledge-base";
import path from "path";
import fs from "fs";

export function scanPlugins(): Entity[] {
  const results: Entity[] = [];
  const pluginsDir = normPath(CLAUDE_DIR, "plugins");

  // Parse blocklist
  const blocklist: Record<string, { reason: string; text: string }> = {};
  const blocklistPath = normPath(pluginsDir, "blocklist.json");
  const blocklistJson = safeReadJson(blocklistPath);
  if (blocklistJson?.plugins) {
    for (const entry of blocklistJson.plugins) {
      blocklist[entry.plugin] = { reason: entry.reason, text: entry.text };
    }
  }

  // Parse known marketplaces
  const marketplacesPath = normPath(pluginsDir, "known_marketplaces.json");
  const marketplacesJson = safeReadJson(marketplacesPath);

  if (marketplacesJson) {
    for (const [marketplaceId, config] of Object.entries(marketplacesJson as Record<string, any>)) {
      const installLocation = config.installLocation?.replace(/\\/g, "/");
      const stat = installLocation ? getFileStat(installLocation) : null;

      // Check if marketplace dir has plugins.
      // Marketplaces may organize plugins into container dirs like "plugins/" and
      // "external_plugins/", so we look one level deeper when a top-level subdir
      // doesn't have any plugin markers itself.
      const mktDir = normPath(pluginsDir, "marketplaces", marketplaceId);
      const pluginDirs: string[] = [];
      const PLUGIN_MARKERS = ["SKILL.md", ".mcp.json", "CLAUDE.md", "manifest.json", "plugin.json", "package.json"];
      const SKIP_DIRS = new Set([".git", ".claude-plugin", "node_modules"]);
      if (dirExists(mktDir)) {
        try {
          const topDirs = fs
            .readdirSync(mktDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name));

          for (const d of topDirs) {
            const fullPath = normPath(mktDir, d.name);
            const hasMarker = PLUGIN_MARKERS.some((m) => fileExists(path.join(fullPath, m)));
            const hasSkillsDir = dirExists(path.join(fullPath, "skills"));

            if (hasMarker || hasSkillsDir) {
              // This is an actual plugin directory
              pluginDirs.push(d.name);
            } else {
              // Likely a container dir (e.g. "plugins/", "external_plugins/")
              // — look one level deeper for actual plugins
              try {
                const subDirs = fs
                  .readdirSync(fullPath, { withFileTypes: true })
                  .filter((sd) => sd.isDirectory() && !SKIP_DIRS.has(sd.name));
                for (const sd of subDirs) {
                  pluginDirs.push(`${d.name}/${sd.name}`);
                }
              } catch {}
            }
          }
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
      for (const pluginRelPath of pluginDirs) {
        const displayName = pluginRelPath.includes("/") ? pluginRelPath.split("/").pop()! : pluginRelPath;
        const pluginKey = `${displayName}@${marketplaceId}`;
        const isBlocked = pluginKey in blocklist;
        const pluginPath = normPath(mktDir, pluginRelPath);
        const hasMcp = fileExists(path.join(pluginPath, ".mcp.json"));

        const id = entityId(`plugin:${pluginKey}`);
        const catalog = PLUGIN_CATALOG[displayName];
        const pluginTags = isBlocked ? ["blocked"] : [];
        if (catalog && !isBlocked) pluginTags.push(catalog.category);

        results.push({
          id,
          type: "plugin",
          name: displayName,
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

  // Extra plugin dirs from settings
  for (const extraDir of getExtraPaths().extraPluginDirs) {
    const normalized = extraDir.replace(/\\/g, "/");
    if (!dirExists(normalized)) continue;
    try {
      const entries = fs.readdirSync(normalized, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const pluginPath = normPath(normalized, entry.name);
        const pluginName = entry.name;
        const id = entityId(`plugin:extra:${pluginPath}`);
        if (results.find((r) => r.id === id)) continue;
        const hasMcp = fileExists(path.join(pluginPath, ".mcp.json"));
        results.push({
          id,
          type: "plugin",
          name: pluginName,
          path: pluginPath,
          description: null,
          lastModified: null,
          tags: [],
          health: "ok",
          data: {
            marketplace: null,
            installed: true,
            blocked: false,
            hasMCP: hasMcp,
          },
          scannedAt: now(),
        });
      }
    } catch {}
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
