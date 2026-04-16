import fs from "fs";
import path from "path";
import os from "os";
import type { Entity, Relationship, MarkdownBackup, AppSettings, CustomNode, CustomEdge, EntityOverride, SessionSummary, PromptTemplate, WorkflowConfig, SessionNote, Decision } from "@shared/types";

const dataDir = process.env.COMMAND_CENTER_DATA
  ? path.resolve(process.env.COMMAND_CENTER_DATA)
  : path.join(os.homedir(), ".claude-command-center");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "command-center.json");
const dbTmpPath = dbPath + ".tmp";

export const CURRENT_SCHEMA_VERSION = 2;

export interface DBData {
  schemaVersion: number;
  entities: Record<string, Entity>;
  relationships: Relationship[];
  markdownBackups: MarkdownBackup[];
  discoveryCache: Record<string, { results: string; cachedAt: string }>;
  nextRelId: number;
  nextBackupId: number;
  appSettings: AppSettings;
  customNodes: CustomNode[];
  customEdges: CustomEdge[];
  entityOverrides: Record<string, EntityOverride>;
  sessionSummaries: Record<string, SessionSummary>;
  promptTemplates: Record<string, PromptTemplate>;
  workflowConfig: WorkflowConfig;
  sessionNotes: Record<string, SessionNote>;
  sessionTitles: Record<string, string>;
  pinnedSessions: string[];
  decisions: Decision[];
  markdownMeta: Record<string, { locked?: boolean; pinned?: boolean }>;
}

export const defaultAppSettings: AppSettings = {
  appName: "Command Center",
  onboarded: false,
  billingMode: "auto",
  selectedPlanId: null,
  planSelectedAt: null,
  scanPaths: {
    homeDir: null,
    claudeDir: null,
    extraMcpFiles: [],
    extraProjectDirs: [],
    extraSkillDirs: [],
    extraPluginDirs: [],
  },
};

function defaultData(): DBData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    entities: {},
    relationships: [],
    markdownBackups: [],
    discoveryCache: {},
    nextRelId: 1,
    nextBackupId: 1,
    appSettings: { ...defaultAppSettings, scanPaths: { ...defaultAppSettings.scanPaths } },
    customNodes: [],
    customEdges: [],
    entityOverrides: {},
    sessionSummaries: {},
    promptTemplates: {},
    workflowConfig: { autoSummarize: false, autoArchiveStale: false, costAlertThreshold: null, autoTagByPath: false },
    sessionNotes: {},
    sessionTitles: {},
    pinnedSessions: [],
    decisions: [],
    markdownMeta: {},
  };
}

/**
 * Apply sequential migrations to bring old DB data up to CURRENT_SCHEMA_VERSION.
 * Each step handles one version bump. Registered migrations run in order.
 */
function migrate(loaded: Partial<DBData> & { schemaVersion?: number }): DBData {
  let version = loaded.schemaVersion ?? 0;
  let out = loaded as DBData;

  // v0 → v1: Backfill all missing fields introduced before schema versioning existed.
  if (version < 1) {
    const defaults = defaultData();
    out = {
      ...defaults,
      ...out,
      schemaVersion: 1,
      appSettings: { ...defaults.appSettings, ...(out.appSettings || {}) },
      workflowConfig: { ...defaults.workflowConfig, ...(out.workflowConfig || {}) },
    };
    version = 1;
  }

  // v1 → v2: Introduce sessionTitles map for user-defined custom session names.
  if (version < 2) {
    out = { ...out, sessionTitles: out.sessionTitles ?? {}, schemaVersion: 2 };
    version = 2;
  }

  return out;
}

let data: DBData;

try {
  if (fs.existsSync(dbPath)) {
    const loaded = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    data = migrate(loaded);
  } else {
    data = defaultData();
  }
} catch (err) {
  console.error("[db] Failed to load database:", (err as Error).message);
  // If the file exists but can't be parsed, create a backup instead of overwriting
  if (fs.existsSync(dbPath)) {
    const backupPath = dbPath + ".corrupt." + Date.now();
    try {
      fs.copyFileSync(dbPath, backupPath);
      console.warn(`[db] Corrupted DB backed up to: ${backupPath}`);
    } catch {}
  }
  data = defaultData();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Atomic write: write to .tmp then rename */
function writeAtomic(content: string): void {
  fs.writeFileSync(dbTmpPath, content, "utf-8");
  fs.renameSync(dbTmpPath, dbPath);
}

export function save(): void {
  // Debounced save
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      writeAtomic(JSON.stringify(data));
    } catch (err) {
      console.error("[db] Failed to save:", err);
    }
  }, 500);
}

export function saveSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    writeAtomic(JSON.stringify(data));
  } catch (err) {
    console.error("[db] Failed to save:", err);
  }
}

export function getDB(): DBData {
  return data;
}

// Flush pending writes on process exit
function onExit() {
  saveSync();
}
process.on("SIGTERM", onExit);
process.on("SIGINT", onExit);
process.on("beforeExit", onExit);
