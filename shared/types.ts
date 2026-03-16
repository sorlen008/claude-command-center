export type EntityType = "project" | "mcp" | "plugin" | "skill" | "markdown" | "config";
export type GraphNodeType = EntityType | "session" | "agent" | "custom";

export type CustomNodeSubType = "service" | "database" | "api" | "cicd" | "deploy" | "queue" | "cache" | "other";

export interface CustomNode {
  id: string;
  subType: CustomNodeSubType;
  label: string;
  description?: string;
  url?: string;
  icon?: string;
  color?: string;
  source: "manual" | "config-file" | "api-config" | "ai-suggested" | "docker-compose" | "auto-discovered";
}

export interface CustomEdge {
  id: string;
  source: string;  // entity ID or custom node ID
  target: string;
  label: string;
  color?: string;
  dashed?: boolean;
  source_origin: "manual" | "config-file" | "api-config" | "ai-suggested" | "docker-compose" | "auto-discovered";
}

// API registry types
export type ApiCategory = "voice" | "communication" | "google" | "infrastructure" | "ai-llm" | "design" | "database";
export type ApiAuthMethod = "api-key" | "oauth2" | "sdk" | "none" | "cdp" | "mcp";
export type ApiStatus = "active" | "configured" | "inactive" | "via-proxy";

export interface ApiDefinition {
  id: string;
  name: string;
  description: string;
  baseUrl?: string;
  authMethod: ApiAuthMethod;
  category: ApiCategory;
  status: ApiStatus;
  envKeys?: string[];
  consumers: string[];
  color?: string;
  website?: string;
  notes?: string;
}

export interface EntityOverride {
  description?: string;
  color?: string;
  label?: string;
}

export interface GraphConfigYaml {
  nodes?: Array<{
    id: string;
    type?: CustomNodeSubType;
    label: string;
    description?: string;
    url?: string;
    icon?: string;
    color?: string;
  }>;
  edges?: Array<{
    source: string;
    target: string;
    label: string;
    color?: string;
    dashed?: boolean;
  }>;
  overrides?: Array<{
    entity: string;  // matches by entity name or ID
    description?: string;
    color?: string;
    label?: string;
  }>;
}

/** Shape of a single MCP server config from .mcp.json */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** Shape of a .mcp.json file (top-level or wrapped) */
export interface MCPConfigFile {
  mcpServers?: Record<string, MCPServerConfig>;
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  path: string;
  description: string | null;
  lastModified: string | null;
  tags: string[];
  health: "ok" | "warning" | "error" | "unknown";
  data: Record<string, unknown>;
  scannedAt: string;
}

export interface Relationship {
  id: number;
  sourceId: string;
  sourceType: EntityType;
  targetId: string;
  targetType: EntityType;
  relation: string;
}

export interface MarkdownBackup {
  id: number;
  filePath: string;
  content: string;
  createdAt: string;
  reason: string;
}

export interface ProjectEntity extends Entity {
  type: "project";
  data: {
    projectKey: string;
    sessionCount: number;
    sessionSize: number;
    hasClaudeMd: boolean;
    hasMemory: boolean;
    longDescription?: string;
    techStack?: string[];
    keyFeatures?: string[];
  };
}

export interface MCPEntity extends Entity {
  type: "mcp";
  data: {
    transport: "stdio" | "sse" | "streamable-http";
    command?: string;
    args?: string[];
    url?: string;
    sourceFile: string;
    projectId?: string;
    env?: Record<string, string>;
    category?: string;
    capabilities?: string[];
    website?: string;
  };
}

export interface SkillEntity extends Entity {
  type: "skill";
  data: {
    userInvocable: boolean;
    args: string | null;
    content: string;
  };
}

export interface PluginEntity extends Entity {
  type: "plugin";
  data: {
    marketplace: string | null;
    installed: boolean;
    blocked: boolean;
    blockReason?: string;
    hasMCP: boolean;
    category?: string;
  };
}

export interface MarkdownEntity extends Entity {
  type: "markdown";
  data: {
    category: "claude-md" | "memory" | "skill" | "readme" | "other";
    projectId?: string;
    sizeBytes: number;
    preview: string;
    frontmatter: Record<string, unknown> | null;
  };
}

export interface ConfigEntity extends Entity {
  type: "config";
  data: {
    configType: "settings" | "settings-local" | "mcp";
    content: Record<string, unknown>;
  };
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  description?: string;
  health: string;
  position: { x: number; y: number };
  parentId?: string;
  group?: { width: number; height: number };
  subType?: CustomNodeSubType;
  color?: string;
  url?: string;
  source?: string;  // origin of custom node
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  style?: { color: string; strokeWidth: number; dashed?: boolean; dotted?: boolean; animated?: boolean };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ScanStatus {
  scanning: boolean;
  lastScanAt: string | null;
  entityCounts: Record<EntityType, number>;
  totalEntities: number;
  totalRelationships: number;
  sessionCount?: number;
  agentCount?: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  model: string;
  color: string;
  tools: string[];
  source: "plugin" | "user" | "project";
  pluginName?: string;
  marketplace?: string;
  filePath: string;
  content: string;
  writable: boolean;
  lastUsed?: string | null;
}

export interface AgentExecution {
  agentId: string;
  slug: string;
  sessionId: string;
  projectKey: string;
  agentType: string | null;
  model: string | null;
  firstMessage: string;
  firstTs: string | null;
  lastTs: string | null;
  messageCount: number;
  sizeBytes: number;
  filePath: string;
}

export interface AgentStats {
  totalExecutions: number;
  totalDefinitions: number;
  sessionsWithAgents: number;
  byType: Record<string, number>;
  byModel: Record<string, number>;
}

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  activeAgents: ActiveAgent[];
  firstMessage?: string;
  lastMessage?: string;
  slug?: string;
  projectKey?: string;
  contextUsage?: {
    tokensUsed: number;
    maxTokens: number;
    percentage: number;
    model?: string;
  };
  messageCount?: number;
  sizeBytes?: number;
  costEstimate?: number;  // USD
  status?: "thinking" | "waiting" | "idle" | "stale";
  permissionMode?: "default" | "auto-accept" | "bypass";
  gitBranch?: string;
}

export interface ActiveAgent {
  agentId: string;
  slug: string;
  agentType: string | null;
  model: string | null;
  lastWriteTs: string;
  task?: string;  // first user message — what the agent is doing
  status: "running" | "recent";  // running = modified <60s, recent = modified <10min
}

export interface LiveData {
  activeSessions: ActiveSession[];
  recentActivity: AgentExecution[];
  stats: {
    activeSessionCount: number;
    activeAgentCount: number;
    agentsToday: number;
    modelsInUse: string[];
  };
}

export interface RuntimeInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  homeDir: string;
  claudeDir: string;
  uptime: number;
  appVersion?: string;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  currentCommit: string;
  latestCommit: string | null;
  commitsBehind: number;
  lastCheckedAt: string | null;
  hasGitRemote: boolean;
  updateInProgress: boolean;
  error: string | null;
}

export interface UpdateApplyResult {
  success: boolean;
  steps: { name: string; status: "success" | "failed" | "skipped"; output: string }[];
  restartRequired: boolean;
  error: string | null;
}

export interface UpdatePreferences {
  enabled: boolean;        // master toggle — false = no checking at all
  autoUpdate: boolean;     // auto-apply updates when found
  dismissedCommit: string | null; // commit hash that was dismissed (ignore)
}

export interface SessionData {
  id: string;
  slug: string;
  firstMessage: string;
  firstTs: string | null;
  lastTs: string | null;
  messageCount: number;
  sizeBytes: number;
  tags: string[];
  isEmpty: boolean;
  isActive: boolean;
  filePath: string;
  projectKey: string;
  cwd: string;
  version: string;
  gitBranch: string;
}

export interface SessionStats {
  totalCount: number;
  totalSize: number;
  activeCount: number;
  emptyCount: number;
}

export interface AppSettings {
  appName: string;
  onboarded: boolean;
  scanPaths: {
    homeDir: string | null;
    claudeDir: string | null;
    extraMcpFiles: string[];
    extraProjectDirs: string[];
    extraSkillDirs: string[];
    extraPluginDirs: string[];
  };
}
