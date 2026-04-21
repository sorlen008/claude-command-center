import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SHORTCUT_SECTIONS } from "@/components/keyboard-shortcuts";
import {
  LifeBuoy,
  Search,
  Rocket,
  Network,
  MessageSquare,
  Radio,
  BarChart3,
  Server,
  Wand2,
  Puzzle,
  FileText,
  Keyboard,
  Shield,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  FolderOpen,
  Activity,
  Bot,
  SlidersHorizontal,
  BookOpen,
  Sparkles,
  ArrowRight,
  Check,
  Terminal,
  Zap,
  Lock,
  Mic,
  Settings2,
} from "lucide-react";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Level = "beginner" | "intermediate" | "advanced";

type Topic = {
  q: string;
  a: React.ReactNode;
  level: Level;
  // Optional plain-text shadow of `a` for future consumers (Ctrl+K index, snapshot
  // tests) that can't walk ReactNode. Falls back to extractText(a) if unset.
  searchText?: string;
};

type Category = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  topics: Topic[];
};

// -----------------------------------------------------------------------------
// Small helpers used inside topic answers
// -----------------------------------------------------------------------------

const C = ({ children }: { children: React.ReactNode }) => (
  <code className="px-1 py-0.5 rounded bg-muted/60 text-[12px] font-mono text-foreground/90">{children}</code>
);

const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-muted/50 text-[11px] font-mono font-medium">{children}</kbd>
);

const LEVEL_STYLE: Record<Level, { label: string; dot: string; text: string }> = {
  beginner:     { label: "B", dot: "bg-green-500",  text: "text-green-400"  },
  intermediate: { label: "I", dot: "bg-amber-500",  text: "text-amber-400"  },
  advanced:     { label: "A", dot: "bg-purple-500", text: "text-purple-400" },
};

// Slugify a topic question for stable DOM + URL keys. Index-based keys (v1)
// broke under difficulty filtering because filtered arrays reorder the index
// domain. Slug keys are stable across sort/filter.
function slugifyTopic(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "topic";
}

function topicKey(categoryId: string, topic: Topic): string {
  return `${categoryId}-${slugifyTopic(topic.q)}`;
}

function isLevelVisible(topicLevel: Level, filter: "beginner" | "all" | "advanced"): boolean {
  if (filter === "beginner") return topicLevel === "beginner";
  if (filter === "advanced") return topicLevel !== "beginner";
  return true;
}

// -----------------------------------------------------------------------------
// Content — 15 categories, ~107 topics. Every factual claim below has been
// verified against the codebase at the time of writing. Source files cited
// where a future reader may want to re-verify after code changes.
// -----------------------------------------------------------------------------

const CATEGORIES: Category[] = [
  // ---------------------------------------------------------------------------
  {
    id: "getting-started",
    label: "Getting Started",
    description: "First-time setup, data sources, and how scanning works.",
    icon: Rocket,
    color: "#3b82f6",
    topics: [
      {
        level: "beginner",
        q: "What is Command Center?",
        a: <>A local dashboard that reads everything in your Claude Code ecosystem — projects, MCP servers, skills, plugins, sessions, costs — and shows them together in one place. Everything runs on your machine; nothing leaves it.</>,
      },
      {
        level: "beginner",
        q: "Where does the data come from?",
        a: <>Sessions come from the JSONL files in <C>~/.claude/projects/</C>. MCPs come from <C>~/.claude/claude_desktop_config.json</C> and any project-local <C>.mcp.json</C>. Skills live in <C>~/.claude/skills/</C>. Plugins live in <C>~/.claude/plugins/</C>. Custom graph nodes come from <C>~/graph-config.yaml</C>. All read-only.</>,
      },
      {
        level: "beginner",
        q: "Does it need internet?",
        a: <>No. The dev server listens on <C>127.0.0.1:5100</C>. The only outbound traffic is when you explicitly use an AI feature, which shells out to your local <C>claude</C> CLI — and degrades cleanly to a 503 message if the CLI isn't installed.</>,
      },
      {
        level: "beginner",
        q: "My dashboard is empty. Why?",
        a: <>Command Center only shows what exists under <C>~/.claude/</C>. If this is a fresh install, run a real Claude Code session first so there's data to scan. Then click Rescan on the Dashboard.</>,
      },
      {
        level: "beginner",
        q: "How often does data refresh?",
        a: <>A background scanner picks up filesystem changes as they happen. Live View additionally polls every 3 seconds for active sessions. You can also force a rescan from the Dashboard or the Activity page.</>,
      },
      {
        level: "intermediate",
        q: "What's stored in command-center.json?",
        a: <>App state that needs to persist across restarts: pinned sessions, session notes, generated summaries, favorites, app name, monthly budget, entity overrides, and graph view preferences. Lives at <C>~/.claude-command-center/command-center.json</C> (configurable via the <C>COMMAND_CENTER_DATA</C> env var).</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "dashboard",
    label: "Dashboard",
    description: "The landing page, Insights, and the Usage budget card.",
    icon: LayoutDashboard,
    color: "#06b6d4",
    topics: [
      {
        level: "beginner",
        q: "What's on the Dashboard?",
        a: <>Entity counts, active sessions, storage usage, a monthly-cost summary, recent file changes, AI insights, and quick-action buttons to Graph, Live, Stats, and Export. It's the map of everything Command Center knows about.</>,
      },
      {
        level: "beginner",
        q: "What are Insights?",
        a: <>Automated suggestions derived from your actual usage: cost-spike alerts, savings opportunities (e.g. Opus → Sonnet), stale sessions worth reviewing, week-over-week trends, budget warnings, and duplicate-work detection. Generated by <C>server/scanner/insights.ts</C>.</>,
      },
      {
        level: "beginner",
        q: "What does the Usage card show?",
        a: <>Today / this week / last 30 days of spend, plus a progress bar against your monthly budget if you've set one in Settings. When spend crosses 80% of budget an orange insight fires; at 100% a red one fires.</>,
      },
      {
        level: "intermediate",
        q: "What does duplicate-work detection actually flag?",
        a: <>Sessions that edited the same files with similar prompts within a short window — usually a sign that two sessions solved the same problem independently. Good cue to consolidate memory files or save a prompt template so future work starts from the existing solution.</>,
      },
      {
        level: "intermediate",
        q: "How is a cost spike calculated?",
        a: <>A rolling 7-day average is computed from daily costs. If a day exceeds 2× that average, an insight fires with the specific session IDs that contributed the most. You can drill into those from the Stats page.</>,
      },
      {
        level: "beginner",
        q: "Can I dismiss an insight?",
        a: <>Not persistently. Insights regenerate on every scan from live data, so dismissal would be overwritten anyway. The right way to "dismiss" is to act on it — adjust your workflow, and the insight won't recur.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "projects",
    label: "Projects",
    description: "How projects are detected, per-project config, and drill-down.",
    icon: FolderOpen,
    color: "#3b82f6",
    topics: [
      {
        level: "beginner",
        q: "What counts as a project?",
        a: <>Any directory Claude Code has run inside — detected from the JSONL files in <C>~/.claude/projects/</C>. Directories with a <C>CLAUDE.md</C>, a <C>.mcp.json</C>, or a git remote get richer metadata.</>,
      },
      {
        level: "beginner",
        q: "Navigating the Projects page",
        a: <>Each row shows project name, tech-stack badges, session count, storage used, CLAUDE.md presence, memory files, and linked MCPs. Click any row to open the Project Detail page.</>,
      },
      {
        level: "beginner",
        q: "What's on the Project Detail page?",
        a: <>CLAUDE.md content if present, linked MCPs and skills, memory files, a timeline of sessions attributed to this project, and quick actions to edit CLAUDE.md or jump into a session.</>,
      },
      {
        level: "intermediate",
        q: "What is the file heatmap?",
        a: <>A view of which files this project has touched most often across all its sessions. Useful for finding hotspots: files edited 30 times probably deserve better tests or a refactor.</>,
      },
      {
        level: "intermediate",
        q: "How does commit linking work?",
        a: <>Command Center matches session timestamps to git commit timestamps to correlate "what you worked on" with "what you committed." Requires the project to be a git repo with local commits.</>,
      },
      {
        level: "advanced",
        q: "Filtering sessions by project via URL",
        a: <>Open <C>/sessions?project=&lt;project-name&gt;</C> to pre-filter the Sessions page to only sessions from that project. The URL param is read in <C>sessions.tsx</C> at mount.</>,
      },
      {
        level: "intermediate",
        q: "Per-project MCP configuration",
        a: <>Drop a <C>.mcp.json</C> next to a project's files to define MCPs that only load when Claude runs from that directory. Command Center picks them up automatically and shows them in the project detail view.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "sessions",
    label: "Sessions",
    description: "Search, pin, summarize, export, delegate, and delete sessions.",
    icon: MessageSquare,
    color: "#a855f7",
    topics: [
      {
        level: "beginner",
        q: "What is a session?",
        a: <>One Claude Code conversation, persisted as a JSONL file in <C>~/.claude/projects/&lt;project&gt;/</C>. Each line is a message, tool call, or tool result. Command Center parses these files to show you costs, timelines, and content without ever writing to them.</>,
      },
      {
        level: "beginner",
        q: "Titles vs Deep vs UUID search",
        a: <>The search box has three modes, toggled from the dropdown. <strong>Titles</strong> searches session titles, slugs, and first messages only (fast). <strong>Deep</strong> (default) searches message content, tool calls, and files edited (slower, more thorough). <strong>UUID</strong> matches session IDs exactly — useful for pasting a UUID from a terminal.</>,
      },
      {
        level: "beginner",
        q: "What does pinning a session do?",
        a: <>Pinned sessions stay at the top of the list, survive the Delete All action, and can be targeted as a dedicated batch by the Summarize dropdown. Use it for sessions you want to keep referring back to.</>,
      },
      {
        level: "beginner",
        q: "Summarize dropdown: All / Top 10 / Pinned",
        a: <>Batch-summarizes up to 10 sessions at a time by shelling out to the <C>claude</C> CLI. <strong>All</strong> picks the next 10 unsummarized. <strong>Top 10</strong> picks the most-used. <strong>Pinned</strong> picks only your pinned sessions. Requires the <C>claude</C> CLI to be installed.</>,
      },
      {
        level: "intermediate",
        q: "Exporting a session as HTML",
        a: <>The download icon on each session generates a standalone, self-contained HTML file with the full message timeline. Sanitized so no absolute paths or PII leak. Shareable — just send the HTML file.</>,
      },
      {
        level: "beginner",
        q: "Resuming a session from the UUID",
        a: <>Click the UUID next to any session to copy it. In your terminal, run <C>claude --resume &lt;uuid&gt;</C> to pick up exactly where that session left off.</>,
      },
      {
        level: "intermediate",
        q: "Delete, Delete All, and Undo",
        a: <>Single delete and bulk delete move sessions to a trash directory. Delete All skips pinned sessions (confirmed in <C>server/routes/sessions.ts</C>). Undo works for the most recent deletion batch only and is cleared on server restart.</>,
      },
      {
        level: "advanced",
        q: "Session delegation to terminal / Telegram / voice",
        a: <>Send a session's next step to an external channel. Terminal delegation opens a new shell at the session's cwd with <C>claude --resume</C>. Telegram and voice delegation are gated behind the <C>VOICE_CALLER_SCRIPT</C> and <C>VOICE_PHONE</C> env vars — unset by default, so the feature is disabled until you configure them.</>,
      },
      {
        level: "advanced",
        q: "Session diffs and overlap detection",
        a: <>Command Center can diff files edited across sessions to find overlapping work — useful when two sessions touched the same feature. Access from the session detail view or the file timeline on the Analytics page.</>,
      },
      {
        level: "advanced",
        q: "What does continuation detection do?",
        a: <>It looks for sessions whose first message references another session's work (e.g. "continuing the refactor from yesterday") and links them as a chain. Lets you trace a multi-day feature across sessions without manual tagging.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "live",
    label: "Live View",
    description: "Active sessions, the Context bar, compaction, and statuses.",
    icon: Radio,
    color: "#f97316",
    topics: [
      {
        level: "beginner",
        q: "What is Live View?",
        a: <>A real-time picture of every Claude Code session currently running on your machine. Polls every 3 seconds. Shows status (thinking/waiting/idle/stale), context usage, active agents, cost so far, and quick actions.</>,
      },
      {
        level: "beginner",
        q: "Reading the Context bar",
        a: <>The bar shows how much of the model's memory window is already filled with messages, tool results, and system instructions. Green (0–40%) means plenty of room; amber (40–70%) is fine but start being deliberate; red (70%+) means Claude is about to start condensing older messages and you may lose nuance. See the <em>Context & Session Tips</em> panel in Live View for the full color-coded guide.</>,
      },
      {
        level: "beginner",
        q: "When to compact — and what /compact does",
        a: <>Click the purple <strong>Compact</strong> button next to the Context label on any session card. A dialog explains and copies <C>/compact</C> to your clipboard. Paste it into the active Claude terminal and Claude replaces older messages with a short summary, freeing up context. Good to do around 60–70% if you still need to finish the same task.</>,
      },
      {
        level: "intermediate",
        q: "BYPASS and AUTO permission flags",
        a: <>The red <strong>BYPASS</strong> badge means Claude is running without asking for tool-call approval — every command runs unprompted. The yellow <strong>AUTO</strong> badge means safe operations auto-accept while risky ones still prompt. Notice these badges: they change what kinds of mistakes are possible in that session.</>,
      },
      {
        level: "advanced",
        q: "The compact overlay mode",
        a: <>Open <C>/live?compact=true</C> to get a minimalist overlay view — just session count, total active cost, and a line per session with its context bar. Designed for a small always-visible window on a second monitor.</>,
      },
      {
        level: "intermediate",
        q: "Orphaned agents stuck in Running",
        a: <>A "stale" row means Command Center can still see an agent marker but the parent Claude process is gone. Refresh Live View and the scanner should drop it. If the row persists, the Claude process is hung — kill it from your terminal and refresh.</>,
      },
      {
        level: "beginner",
        q: "Session statuses: Thinking, Waiting, Idle, Stale",
        a: <><strong>Thinking</strong> — Claude is actively generating or running a tool. <strong>Waiting</strong> — Claude is waiting for your approval on a tool call. <strong>Idle</strong> — session is open but no activity in the last few seconds. <strong>Stale</strong> — no parent process or JSONL hasn't updated in a long time.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "graph",
    label: "Entity Graph",
    description: "Views, filters, blast radius, and performance.",
    icon: Network,
    color: "#22c55e",
    topics: [
      {
        level: "beginner",
        q: "What does the Graph show?",
        a: <>Every entity Command Center knows about and the relationships between them — projects link to MCPs, MCPs provide data to projects, skills belong to projects, and so on. It's the visual answer to "what depends on what?"</>,
      },
      {
        level: "beginner",
        q: "Six view modes",
        a: <><strong>Graph</strong> (force-directed node diagram), <strong>Tiles</strong> (grouped cards), <strong>Tree</strong> (hierarchy), <strong>List</strong> (flat table), <strong>Radial</strong> (circular hub), <strong>Matrix</strong> (adjacency grid). Your last-used mode is remembered. Use the toolbar toggle at top-right.</>,
      },
      {
        level: "intermediate",
        q: "Pan and zoom feel slow — what can I do?",
        a: <>Hide the MiniMap (map icon in the toolbar — it re-renders all nodes on every viewport change). Filter out entity types you don't need. Command Center already hides nodes during pan/zoom for speed, so the motion itself should be instant — content reappears when motion stops.</>,
      },
      {
        level: "intermediate",
        q: "Blast radius and the BFS highlight",
        a: <>Click any node and Command Center runs a breadth-first search out from it, highlighting everything reachable through relationships. The detail sheet then counts by type ("if this MCP changes, 5 projects are affected"). That's the blast radius.</>,
      },
      {
        level: "intermediate",
        q: "Edge colors and relationship types",
        a: <>Every relationship has a color: green for uses_mcp, blue for defines_mcp, orange for has_skill, purple for provides_mcp, red for depends_on, and so on. Toggle the legend (eye icon) to see only the colors currently in view.</>,
      },
      {
        level: "advanced",
        q: "Custom nodes via graph-config.yaml",
        a: <>Edit <C>~/graph-config.yaml</C> to add custom nodes (databases, APIs, services, whatever) and custom edges between any two entities. Changes are picked up on the next scan. This is how you wire external services into the graph alongside the auto-detected ones.</>,
      },
      {
        level: "beginner",
        q: "MiniMap and the filter toolbar",
        a: <>The MiniMap (bottom-right, toggle via the toolbar) shows the full graph with your current viewport rectangle. The filter toolbar (top-left) toggles entity types on and off. Both remember their state in localStorage.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "activity",
    label: "Activity & Discovery",
    description: "Change log, scan stats, and auto-discovery of infrastructure.",
    icon: Activity,
    color: "#14b8a6",
    topics: [
      {
        level: "beginner",
        q: "What does the Activity page show?",
        a: <>A timeline of recent file changes (added, removed, modified) grouped by Today / Yesterday / Earlier, plus scan statistics — scan version, total entities, relationships, last scan duration.</>,
      },
      {
        level: "intermediate",
        q: "Auto-detected infrastructure",
        a: <>Command Center walks <C>docker-compose.yml</C> files to turn services into graph nodes, parses <C>.env</C> files for database and service URLs, and reads git remotes to build cross-project edges. All of this appears under Discovery.</>,
      },
      {
        level: "intermediate",
        q: "AI Suggest on the Graph",
        a: <>A one-click action that shells out to <C>claude</C> to analyze your current graph and propose new relationships — e.g. "Project X uses MCP Y but isn't linked to it." Accepted suggestions are written back as edges.</>,
      },
      {
        level: "beginner",
        q: "Events timeline",
        a: <>An append-only log of what changed recently across your <C>~/.claude/</C> tree. Useful for debugging "what did I just do" when something stops working.</>,
      },
      {
        level: "beginner",
        q: "Why are Discovery and Activity the same route?",
        a: <>They were merged in a recent cleanup — both answer "what has changed lately and what infrastructure exists?" One page, two tabs.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "stats",
    label: "Stats & Analytics",
    description: "Cost tracking, budgets, model breakdowns, and CSV export.",
    icon: BarChart3,
    color: "#eab308",
    topics: [
      {
        level: "beginner",
        q: "Where do the cost numbers come from?",
        a: <>Command Center parses the token counts (input, output, cache-read, cache-write) directly out of each session's JSONL, then multiplies by a pricing table in <C>server/scanner/pricing.ts</C>. Because the inputs are real token counts, the numbers match what Anthropic bills you — not an estimate.</>,
      },
      {
        level: "intermediate",
        q: "Input vs output vs cache tokens",
        a: <><strong>Input</strong> — tokens you sent to the model (prompt). <strong>Output</strong> — tokens the model generated. <strong>Cache-read</strong> — prior tokens re-served from prompt cache, cheap. <strong>Cache-write</strong> — tokens newly written to prompt cache, slightly more expensive than input. Cache usage is usually what makes a repeat session cheap.</>,
      },
      {
        level: "beginner",
        q: "Setting a monthly budget",
        a: <>Open Settings, set the Monthly Budget field. Dashboard's Usage card will start showing a progress bar. At 80% spend a warning insight fires; at 100% a critical insight fires. Budget is stored in <C>command-center.json</C>.</>,
      },
      {
        level: "beginner",
        q: "Opus vs Sonnet vs Haiku",
        a: <>Opus is ~5× the per-token cost of Sonnet and ~20× the cost of Haiku. If your monthly spend feels high, check the per-model breakdown on Stats — moving routine work (summaries, git chores, file edits) to a cheaper model usually cuts a big slice immediately.</>,
      },
      {
        level: "beginner",
        q: "Exporting cost data as CSV",
        a: <>On Stats → Costs tab, click the Download button. You get a CSV of daily costs with columns: date, inputTokens, outputTokens, cacheRead, cacheWrite, cost. Drop it into any spreadsheet.</>,
      },
      {
        level: "intermediate",
        q: "The cost-optimizer insight, worked example",
        a: <>If Command Center sees a session where Opus was used for short, simple messages (e.g. "commit this" or "what does this file do"), it computes what the session would have cost on Sonnet or Haiku and adds up the savings across all such sessions. The insight shows the delta as real dollars.</>,
      },
      {
        level: "intermediate",
        q: "Weekly digest",
        a: <>A Monday-morning summary of the past 7 days: total spend, top models, top projects, anomalies, and any budget burn-rate concerns. Generated by <C>server/scanner/weekly-digest.ts</C> and shown on the Stats page.</>,
      },
      {
        level: "beginner",
        q: "Model breakdown and daily cost curve",
        a: <>The Models tab shows token usage and cost split by model. The daily curve on the Costs tab shows the past 30 days; hover a bar to see that day's exact spend.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "mcps",
    label: "MCP Servers",
    description: "What MCPs are, how they're categorized, and health checks.",
    icon: Server,
    color: "#8b5cf6",
    topics: [
      {
        level: "beginner",
        q: "What is an MCP server?",
        a: <>Model Context Protocol servers extend Claude with tools — databases, browsers, email, calendars, whatever. You point Claude at an MCP via <C>claude_desktop_config.json</C> or a per-project <C>.mcp.json</C>, and those tools become callable from inside any session.</>,
      },
      {
        level: "intermediate",
        q: "How are MCPs categorized?",
        a: <>By name-matching against a curated catalog in <C>server/scanner/knowledge-base.ts</C>. At the time of writing, the catalog has 38 known MCPs across 6 categories (data, dev-tools, integration, ai, browser, productivity). Anything not in the catalog goes to "Other" — add your own to the catalog and rescan to categorize it.</>,
      },
      {
        level: "intermediate",
        q: "MCP recommendations — how they're chosen",
        a: <>Command Center looks at the technologies in your projects (package.json, Dockerfiles, env files) and suggests MCPs that match. PostgreSQL in your stack → suggests the Postgres MCP. Python in your stack → suggests the Python MCP. See <C>server/scanner/mcp-recommender.ts</C> for the logic.</>,
      },
      {
        level: "intermediate",
        q: "Debugging a Broken MCP",
        a: <>Click the MCP and look at the last health check output — exit code, stderr, and the exact command it tried. Most common causes: missing env vars, wrong working directory, <C>npx</C> package not installed, or a Windows-vs-POSIX path issue. Run the same command in your own shell to reproduce.</>,
      },
      {
        level: "advanced",
        q: "What a health check actually measures",
        a: <>Command Center spawns the MCP's command in the same way Claude would, waits for it to respond to a protocol handshake or time out, and records exit code, stderr, and duration. Not a deep test — just "does this thing start without crashing?" — but catches 80% of real breakage.</>,
      },
      {
        level: "intermediate",
        q: "Global vs per-project MCPs",
        a: <>Global MCPs in <C>~/.claude/claude_desktop_config.json</C> are available in every session. Per-project MCPs in a <C>.mcp.json</C> next to the project load only when Claude runs from that directory. Use per-project when an MCP needs project-specific env vars or credentials.</>,
      },
      {
        level: "advanced",
        q: "Adding your own MCP to the catalog",
        a: <>Edit <C>server/scanner/knowledge-base.ts</C>, add an entry to the <C>MCP_CATALOG</C> object keyed by the MCP name, give it a description, category, and capabilities list. Rescan and it'll be categorized correctly.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "skills-plugins",
    label: "Skills & Plugins",
    description: "Auto-categorization, creating skills, installing plugins.",
    icon: Wand2,
    color: "#f59e0b",
    topics: [
      {
        level: "beginner",
        q: "Skill vs Plugin — what's the difference?",
        a: <>A <strong>skill</strong> is one user-invokable workflow (a slash command like <C>/commit</C> or <C>/release</C>) stored in <C>~/.claude/skills/&lt;name&gt;/</C>. A <strong>plugin</strong> is a bundle that can contain multiple skills plus commands, agents, and hooks, installed via the Claude CLI's <C>/plugin</C> command.</>,
      },
      {
        level: "intermediate",
        q: "Creating a new skill",
        a: <>Make a folder <C>~/.claude/skills/&lt;your-skill&gt;/</C> and drop a <C>SKILL.md</C> file inside with the skill description and instructions. Command Center picks it up on the next scan and auto-categorizes it based on keywords in the name and description.</>,
      },
      {
        level: "beginner",
        q: "Favoriting and auto-categorization",
        a: <>Skills get a category inferred from keywords in their name/description — <em>devops</em>, <em>quality</em>, <em>docs</em>, <em>ai</em>, <em>data</em>, etc. Favorite any skill with the star icon to pin it at the top of its category. Toggle grouping off in the toolbar to see a flat list instead.</>,
      },
      {
        level: "beginner",
        q: "Installing a plugin",
        a: <>In your Claude Code terminal, run <C>/plugin install &lt;name&gt;</C> or point it at a GitHub URL. Command Center picks up the new plugin on the next scan — no restart needed.</>,
      },
      {
        level: "intermediate",
        q: "Where plugins live",
        a: <>Under <C>~/.claude/plugins/&lt;name&gt;/</C>. Each plugin has a <C>plugin.json</C> manifest and subdirectories for its contents.</>,
      },
      {
        level: "intermediate",
        q: "Plugin bundle contents",
        a: <>A plugin can ship any combination of skills, commands, agents, and hooks. Command Center scans the plugin's manifest and shows each component on its own tab in the plugin detail page.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "markdown",
    label: "Markdown, Memory & Messages",
    description: "Editing CLAUDE.md files, memory safety, and Message History.",
    icon: FileText,
    color: "#64748b",
    topics: [
      {
        level: "beginner",
        q: "What files show up under Markdown?",
        a: <>Every <C>*.md</C> under <C>~/.claude/</C> — CLAUDE.md, skill docs, memory files, plugin docs — plus any CLAUDE.md files in your git repos. All editable in-browser.</>,
      },
      {
        level: "beginner",
        q: "Autosave and the Saved badge",
        a: <>The markdown editor saves about 1.5 seconds after you stop typing. A green Saved badge flashes on success. If autosave is off (e.g. on a locked file) the badge won't appear and you'll need to save manually.</>,
      },
      {
        level: "beginner",
        q: "Locked (read-only) files",
        a: <>Some files — templates, system defaults — are marked as locked. The editor disables all saves on locked files to prevent accidental overwrites. You can still read and copy content.</>,
      },
      {
        level: "intermediate",
        q: "Editing memory files safely",
        a: <>Memory files are how Claude remembers things across conversations. Bad edits affect every future session in that project. Edit the same way you'd edit production config: read before you change, and prefer appending over rewriting.</>,
      },
      {
        level: "advanced",
        q: "Version history, overlap, and validation",
        a: <>The editor keeps a rolling history of saved versions and will warn you if a new edit duplicates content already present elsewhere (overlap detection). Markdown syntax and frontmatter get validated on save.</>,
      },
      {
        level: "beginner",
        q: "What's on the Message History page?",
        a: <>A searchable timeline of every message across every session — user turns, assistant turns, tool calls, and tool results — with timestamps, models, and token counts. Filter by role to focus on just user or just assistant.</>,
      },
      {
        level: "intermediate",
        q: "Searching raw message content",
        a: <>The Sessions page's Deep mode already searches message content, but Message History gives you a cross-session flat view — useful when you remember an exact phrase but not which session you said it in.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "agents-apis-prompts",
    label: "Agents, APIs & Prompts",
    description: "Agent definitions, API catalog, and reusable prompt templates.",
    icon: Bot,
    color: "#ec4899",
    topics: [
      {
        level: "beginner",
        q: "What does the Agents page show?",
        a: <>Three tabs: <strong>Definitions</strong> (all agent YAML specs from plugins and your own user agents), <strong>History</strong> (past agent executions pulled out of sessions), and <strong>Stats</strong> (totals, model distribution, and usage over time).</>,
      },
      {
        level: "intermediate",
        q: "APIs page and apis-config.yaml",
        a: <>The APIs page lists everything Command Center identifies as an external service — from <C>~/apis-config.yaml</C>, from .env files, from Docker Compose, and from git remotes. Each row shows the API type, endpoint, and auth method.</>,
      },
      {
        level: "beginner",
        q: "What are prompt templates?",
        a: <>Reusable prompts you save once and paste into any session. Good for repetitive asks — "review this PR," "explain the test failure," "summarize this file." Each template has a name, description, tags, and optional project scope.</>,
      },
      {
        level: "beginner",
        q: "Creating a prompt template",
        a: <>Open the Prompts page, click Create, fill in name + description + prompt body + tags. Save. It's immediately available for copying into any session. Stored in <C>command-center.json</C>.</>,
      },
      {
        level: "intermediate",
        q: "Running an NL Query",
        a: <>The NL Query box accepts natural-language questions about your sessions — "what did I work on last Tuesday?", "which sessions used Opus?", "show me sessions that failed." Answered by shelling out to <C>claude</C>, so it requires the CLI.</>,
      },
      {
        level: "advanced",
        q: "Entity overrides",
        a: <>Rename, recolor, or re-icon any auto-detected entity from Settings → Entity Overrides. Useful when an MCP's technical name is ugly or you want a project to show up under a different label in the graph.</>,
      },
      {
        level: "advanced",
        q: "What the bash knowledge base is",
        a: <>Command Center extracts every bash command run inside your sessions and indexes them by frequency and context. Lets you search your own command history ("did I ever run <C>ffmpeg</C> with this flag?") and copy back the exact invocation.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "settings",
    label: "Settings & Config",
    description: "App name, budget, overrides, env vars, and config files.",
    icon: SlidersHorizontal,
    color: "#0ea5e9",
    topics: [
      {
        level: "beginner",
        q: "Where is Settings now?",
        a: <>Settings and Config were merged in a recent cleanup. Everything is at <C>/settings</C> — <C>/config</C> redirects there. Path configuration, app name, theme, budget, and overrides all live on this one page.</>,
      },
      {
        level: "beginner",
        q: "App name, theme, onboarding toggle",
        a: <>Rename Command Center to anything you like (shown in the sidebar header). Switch between dark, light, and glass themes. Re-run the onboarding wizard any time from the "Run Onboarding" button.</>,
      },
      {
        level: "intermediate",
        q: "Monthly budget and entity overrides",
        a: <>Set a monthly spend budget for cost tracking. Override any detected entity's display name, color, or icon — useful when the auto-detected label is ugly.</>,
      },
      {
        level: "intermediate",
        q: "Environment variables overview",
        a: <>See the Cheat Sheet tab for the full table. Quick list: <C>PORT</C>, <C>HOST</C>, <C>COMMAND_CENTER_DATA</C>, <C>NERVE_CENTER_SERVICES</C>, <C>VOICE_CALLER_SCRIPT</C>, <C>VOICE_PHONE</C>. Unset env vars mean the feature is disabled, not broken.</>,
      },
      {
        level: "intermediate",
        q: "Config files reference",
        a: <><C>~/.claude/claude_desktop_config.json</C> — global MCPs. <C>~/graph-config.yaml</C> — custom graph nodes. <C>~/apis-config.yaml</C> — API definitions. <C>.mcp.json</C> next to any project — per-project MCPs. <C>~/.claude-command-center/command-center.json</C> — app state (pins, summaries, budget).</>,
      },
      {
        level: "advanced",
        q: "new-user-safety test and the CLAUDE.md validator",
        a: <>Command Center ships with <C>tests/new-user-safety.test.ts</C> that scans all source for hardcoded paths, PII, and missing Claude CLI guards. A git pre-commit hook blocks commits that fail it. This is how the public repo stays clean.</>,
      },
      {
        level: "intermediate",
        q: "Restoring defaults",
        a: <>Delete <C>~/.claude-command-center/command-center.json</C> and restart the server to get a pristine state. Your Claude Code sessions under <C>~/.claude/projects/</C> are untouched — only Command Center's own metadata resets.</>,
      },
      {
        level: "beginner",
        q: "Re-running Onboarding",
        a: <>Settings → "Run Onboarding" button. Or use the deep link <C>/help#first-5-minutes</C> to see the First 5 Minutes walkthrough instead.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "keyboard",
    label: "Keyboard, URLs & Power Features",
    description: "All shortcuts, URL params, and advanced navigation.",
    icon: Keyboard,
    color: "#a855f7",
    topics: [
      {
        level: "beginner",
        q: "All global shortcuts",
        a: <>Press <K>?</K> any time to see the full overlay. Core set: <K>Ctrl</K>+<K>K</K> global search, <K>Ctrl</K>+<K>L</K> or <K>Ctrl</K>+<K>B</K> toggle sidebar, <K>?</K> this overlay, plus the <K>G</K>+letter navigation chords below. See the Cheat Sheet tab for the full grid.</>,
      },
      {
        level: "intermediate",
        q: "G + letter navigation chords",
        a: <>Press <K>G</K> then a second letter within a second to jump to a page. <K>G</K><K>D</K> Dashboard, <K>G</K><K>S</K> Sessions, <K>G</K><K>A</K> Agents, <K>G</K><K>G</K> Graph, <K>G</K><K>L</K> Live, <K>G</K><K>M</K> MCPs, <K>G</K><K>P</K> Projects, <K>G</K><K>K</K> Skills.</>,
      },
      {
        level: "beginner",
        q: "Ctrl+B and Ctrl+L for the sidebar",
        a: <>Both toggle the sidebar between collapsed and expanded. Ctrl+L is the original binding; Ctrl+B was added to match VS Code's convention. Either works from any page.</>,
      },
      {
        level: "beginner",
        q: "Ctrl+K global search",
        a: <>The command palette searches sessions, entities (projects/MCPs/skills/plugins), and markdown files in one box. Type a few characters, arrow to select, enter to jump. Recent searches are remembered locally.</>,
      },
      {
        level: "advanced",
        q: "URL parameters overview",
        a: <><C>/sessions?project=&lt;name&gt;</C> pre-filters Sessions by project. <C>/live?compact=true</C> gives the minimalist overlay. <C>/help#&lt;hash&gt;</C> deep-links into this Help Center. The hash format for Help is described in the "Deep-linking Help topics" topic.</>,
      },
      {
        level: "advanced",
        q: "Deep-linking Help topics",
        a: <><C>/help#sessions</C> opens the Sessions category expanded. <C>/help#sessions:3</C> opens and expands topic index 3 inside Sessions. <C>/help#first-5-minutes</C>, <C>/help#glossary</C>, and <C>/help#cheat-sheet</C> jump directly to those tabs. <C>/help#q=compact</C> pre-fills the search with "compact".</>,
      },
      {
        level: "beginner",
        q: "The ? overlay vs the Cheat Sheet tab",
        a: <>The <K>?</K> overlay is a tiny popup showing just keyboard shortcuts. The Cheat Sheet tab here is the richer version: shortcuts <em>plus</em> URL params <em>plus</em> environment variables, all on one page.</>,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: "privacy-troubleshooting",
    label: "Privacy, Safety & Troubleshooting",
    description: "Data locality, PII protection, and when things go wrong.",
    icon: Shield,
    color: "#ef4444",
    topics: [
      {
        level: "beginner",
        q: "Does Command Center send data anywhere?",
        a: <>No. Every scanner, route, and page runs locally on <C>127.0.0.1:5100</C>. AI features shell out to your local <C>claude</C> CLI, which is the only outbound path — and that only fires when you explicitly trigger an AI action.</>,
      },
      {
        level: "advanced",
        q: "new-user-safety test and the pre-commit hook",
        a: <>A vitest suite at <C>tests/new-user-safety.test.ts</C> scans all source for hardcoded user paths, phone numbers, PII, and user-specific UI strings. A git pre-commit hook runs it on every commit. The hook lives at <C>.git/hooks/pre-commit</C> and is documented in <C>CLAUDE.md</C> for reconstruction if lost.</>,
      },
      {
        level: "intermediate",
        q: "Session HTML export sanitation",
        a: <>Exported sessions strip absolute paths, replace home directories with <C>~</C>, and remove anything that looks like an API key, phone number, or email. Safe to share.</>,
      },
      {
        level: "beginner",
        q: "Where is my data stored?",
        a: <>App state in <C>~/.claude-command-center/command-center.json</C>. Session data is read-only from <C>~/.claude/projects/</C> — Command Center never writes session files. Settings and pins go in the command-center JSON.</>,
      },
      {
        level: "intermediate",
        q: "Server won't start on port 5100",
        a: <>Port's in use. Set <C>PORT=5101</C> in your environment or find and kill the conflicting process. On Windows: <C>netstat -ano | findstr :5100</C>. Health check URL: <C>http://localhost:5100/health</C>.</>,
      },
      {
        level: "beginner",
        q: "My counts don't match reality",
        a: <>Hit the manual Rescan button on the Dashboard. The background watcher is usually within seconds of reality, but on network drives or with lots of small file changes it can miss events. A manual rescan walks every directory fresh.</>,
      },
      {
        level: "beginner",
        q: "'Claude CLI not available' error",
        a: <>Install the Claude CLI with <C>npm i -g @anthropic-ai/claude-code</C> and make sure <C>claude --version</C> runs from your shell. Command Center probes for it before any AI call and returns 503 if missing, rather than crashing.</>,
      },
      {
        level: "beginner",
        q: "Where are the logs?",
        a: <>The dev server logs to the terminal you ran <C>npm run dev</C> from. If you auto-started it via the Windows startup folder or a systemd unit, those logs may be hidden — run the server manually to see errors. Routes log important events to stdout.</>,
      },
      {
        level: "beginner",
        q: "Reporting a bug",
        a: <>Open an issue at <a href="https://github.com/sorlen008/claude-command-center/issues" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">the GitHub repo <ExternalLink className="h-3 w-3" /></a>. Include: the version number from the sidebar, what you did, what you expected, what actually happened, and any relevant stack trace from the server console.</>,
      },
    ],
  },
];

// -----------------------------------------------------------------------------
// Glossary — ~50 terms, defined in one sentence each.
// -----------------------------------------------------------------------------

type GlossaryEntry = { term: string; definition: React.ReactNode };

const GLOSSARY: GlossaryEntry[] = [
  { term: "Agent", definition: <>A Claude sub-process that runs a specific workflow (defined in YAML) with its own tools, model, and prompt.</> },
  { term: "AUTO mode", definition: <>Claude's auto-accept permission level where safe tool calls proceed without prompting but risky ones still ask.</> },
  { term: "BFS (breadth-first search)", definition: <>Graph traversal algorithm used for blast radius: visits all direct connections, then their connections, then theirs.</> },
  { term: "Blast radius", definition: <>Every entity reachable from a selected graph node via relationships. Shown in the detail sheet when you click a node.</> },
  { term: "Budget", definition: <>Optional monthly spend cap set in Settings; triggers Insight warnings at 80% and 100%.</> },
  { term: "BYPASS mode", definition: <>Claude running without any tool-call approval prompts. Every command executes unprompted. Shown as a red badge.</> },
  { term: "Cache-read tokens", definition: <>Tokens served from prompt cache on subsequent requests. Cheap compared to input tokens.</> },
  { term: "Cache-write tokens", definition: <>Tokens newly written to prompt cache. Slightly more expensive than input tokens but enable cheap later reads.</> },
  { term: "Claude CLI", definition: <>The <C>claude</C> command-line tool. Required for all AI features (summarize, NL query, AI Suggest).</> },
  { term: "claude_desktop_config.json", definition: <>File at <C>~/.claude/claude_desktop_config.json</C> that defines global MCP servers visible to every Claude session.</> },
  { term: "CLAUDE.md", definition: <>Project-level instructions file Claude reads on every session start in that project. Like a prompt preamble.</> },
  { term: "Compact / /compact", definition: <>Slash command that asks Claude to replace older messages in the current session with a summary, freeing up context window.</> },
  { term: "command-center.json", definition: <>Persistent app state file at <C>~/.claude-command-center/command-center.json</C>. Pins, summaries, budgets, overrides.</> },
  { term: "Context bar", definition: <>The progress bar on each live session card showing what fraction of the model's context window is already filled.</> },
  { term: "Context window", definition: <>The maximum number of tokens a model can process in one conversation before it starts compacting or losing earlier content.</> },
  { term: "Continuation", definition: <>Detection that a session references or builds on a previous session's work, linking them as a chain.</> },
  { term: "Deep search", definition: <>Sessions-page search mode that matches against full message content and tool calls, not just titles.</> },
  { term: "Delegation", definition: <>Sending a session's next step to an external channel: terminal, Telegram, or voice call.</> },
  { term: "Discovery", definition: <>Auto-detection of infrastructure around your projects — Docker Compose services, env-file databases, git remotes.</> },
  { term: "Entity", definition: <>Any thing Command Center tracks: project, MCP, skill, plugin, markdown file, session, config, or custom node.</> },
  { term: "Entity override", definition: <>Per-entity customization in Settings — rename, recolor, re-icon any auto-detected entity.</> },
  { term: "Force-directed graph", definition: <>Layout algorithm where nodes repel each other and edges pull them together, producing organic clusters.</> },
  { term: "graph-config.yaml", definition: <>File at <C>~/graph-config.yaml</C> where you define custom graph nodes and edges beyond what auto-detection finds.</> },
  { term: "Health check", definition: <>A spawn-and-wait test Command Center runs against every MCP to verify it starts without crashing.</> },
  { term: "Input tokens", definition: <>Tokens you send to the model as prompt. Priced cheaper than output tokens.</> },
  { term: "Insight", definition: <>An automated, actionable suggestion from <C>server/scanner/insights.ts</C> — cost spike, savings opportunity, stale session, budget alert.</> },
  { term: "JSONL", definition: <>JSON-lines format: one JSON object per line. Claude Code stores each session as a JSONL file.</> },
  { term: "Knowledge base", definition: <>Curated catalog of known MCPs and plugins in <C>server/scanner/knowledge-base.ts</C>, used for categorization.</> },
  { term: "Live View", definition: <>The page showing currently running Claude sessions, polled every 3 seconds.</> },
  { term: "MCP (Model Context Protocol)", definition: <>A protocol for exposing tools to Claude. MCP servers provide databases, APIs, browsers, etc.</> },
  { term: "Memory file", definition: <>Markdown file in a project's memory directory that Claude loads on session start as long-term memory.</> },
  { term: "MiniMap", definition: <>Bottom-right graph widget showing the full layout with your current viewport as a rectangle.</> },
  { term: "Model (Opus/Sonnet/Haiku)", definition: <>Anthropic's three model tiers. Opus is strongest and priciest; Sonnet is middle; Haiku is cheap and fast.</> },
  { term: "Onboarding", definition: <>The first-run wizard that introduces Command Center and can be re-triggered from Settings.</> },
  { term: "Output tokens", definition: <>Tokens the model generates in its response. Priced higher than input tokens.</> },
  { term: "Pin", definition: <>Mark a session or MCP to stay at the top of lists and survive bulk delete operations.</> },
  { term: "Plugin", definition: <>Bundle installed via <C>/plugin install</C> that can contain skills, commands, agents, and hooks.</> },
  { term: "Prompt template", definition: <>A saved, reusable prompt with name, description, tags, and body. Copyable into any session.</> },
  { term: "Project", definition: <>A directory Claude Code has run inside. Detected from <C>~/.claude/projects/</C> JSONL files.</> },
  { term: "Rescan", definition: <>Manual trigger that walks the filesystem fresh instead of relying on the background watcher.</> },
  { term: "Session", definition: <>One Claude Code conversation, persisted as a JSONL file and indexed by UUID.</> },
  { term: "Session UUID", definition: <>The 36-character identifier for a session, used with <C>claude --resume &lt;uuid&gt;</C> to pick up where you left off.</> },
  { term: "Skill", definition: <>A user-invokable workflow stored in <C>~/.claude/skills/&lt;name&gt;/SKILL.md</C>. Often exposed as a slash command.</> },
  { term: "Summarize batch", definition: <>Shell out to <C>claude</C> to generate titles and summaries for multiple sessions at once. Capped at 10 per batch.</> },
  { term: "Token", definition: <>The unit of text the model processes. Roughly 4 characters or 0.75 words per token.</> },
  { term: "Tool result", definition: <>The output Claude receives after calling a tool. Counts against the context window like any other message.</> },
  { term: "Undo delete", definition: <>One-shot reversal of the most recent deletion batch. Cleared on server restart — not durable.</> },
  { term: "URL hash deep-link", definition: <>The <C>#</C> part of a URL. Command Center uses it for Help navigation without adding new routes.</> },
  { term: "Weekly digest", definition: <>A Monday-morning spend summary of the past 7 days, generated by <C>server/scanner/weekly-digest.ts</C>.</> },
];

// -----------------------------------------------------------------------------
// Cheat Sheet data. Keyboard shortcuts are derived from SHORTCUT_SECTIONS in
// keyboard-shortcuts.tsx so the overlay and the Cheat Sheet can never drift.
// Add new shortcuts there; they'll appear here automatically.
// URL params and env vars sourced from CLAUDE.md.
// -----------------------------------------------------------------------------

// Extra entries documented in the Cheat Sheet but not in the compact `?` overlay.
const CHEAT_EXTRA_GLOBAL: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "B"], label: "Toggle sidebar (alt)" },
  { keys: ["Esc"], label: "Close dialogs and sheets" },
];

const CHEAT_SHORTCUTS: { title: string; hint?: string; items: { keys: string[]; label: string }[] }[] =
  SHORTCUT_SECTIONS.map((section) => ({
    title: section.title,
    hint: section.description,
    items: section.title === "Global"
      ? [...section.shortcuts, ...CHEAT_EXTRA_GLOBAL]
      : [...section.shortcuts],
  }));

const CHEAT_URL_PARAMS: { url: string; effect: string }[] = [
  { url: "/sessions?project=<name>", effect: "Pre-filter the Sessions page to one project" },
  { url: "/live?compact=true",       effect: "Minimalist overlay view of active sessions" },
  { url: "/help#first-5-minutes",    effect: "Open Help Center on the First 5 Minutes tab" },
  { url: "/help#glossary",           effect: "Open Help Center on the Glossary tab" },
  { url: "/help#cheat-sheet",        effect: "Open Help Center on the Cheat Sheet tab" },
  { url: "/help#sessions",           effect: "Help Center, Sessions category expanded" },
  { url: "/help#sessions:3",         effect: "Help Center, Sessions category with topic index 3 open" },
  { url: "/help#q=compact",          effect: "Help Center, search pre-filled with 'compact'" },
];

const CHEAT_ENV_VARS: { name: string; purpose: string; default: string }[] = [
  { name: "PORT",                 purpose: "Server port",                                      default: "5100" },
  { name: "HOST",                 purpose: "Server host",                                      default: "127.0.0.1" },
  { name: "COMMAND_CENTER_DATA",  purpose: "Data directory for command-center.json",           default: "~/.claude-command-center" },
  { name: "NERVE_CENTER_SERVICES", purpose: "Services to monitor (name:port,name:port)",       default: "Command Center:5100" },
  { name: "VOICE_CALLER_SCRIPT",  purpose: "Path to voice outbound caller script",             default: "(disabled)" },
  { name: "VOICE_PHONE",          purpose: "Phone number for voice call delegation",           default: "(disabled)" },
];

// -----------------------------------------------------------------------------
// Claude Code Guide — reference for every CLI command, shortcut, and feature.
// Sourced from Anthropic docs, release notes, and community research.
// -----------------------------------------------------------------------------

type CliItem = {
  name: string;
  syntax: string;
  description: React.ReactNode;
  when: string;
  tips?: React.ReactNode;
  level: Level;
};

type CliCategory = {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  items: CliItem[];
};

const CLI_CATEGORIES: CliCategory[] = [
  {
    id: "cc-essential",
    label: "Essential Commands",
    icon: Rocket,
    color: "#3b82f6",
    items: [
      { name: "/compact", syntax: "/compact [focus instructions]", description: <>Compresses your conversation mid-session to free context window space. Claude summarizes what happened so far and continues from the summary. You can add focus instructions like <C>/compact focus on the auth module</C> to guide what's kept.</>, when: "When your context is filling up but you're not done with the task. Ctrl+O shows your usage.", tips: <>Your previous uncompacted session is still accessible via <C>/resume</C>. Compaction is lossy — Claude may lose track of small details.</>, level: "beginner" },
      { name: "/plan", syntax: "/plan [description]", description: <>Enters plan mode. Claude reads and explores your codebase, writes a structured implementation plan, then asks how to proceed. You can approve into auto mode, accept-edits mode, or review each change.</>, when: "Before starting non-trivial tasks. Helps you align on approach before Claude writes code.", tips: <>You can also switch to plan mode mid-session via <K>Shift</K>+<K>Tab</K>. The plan is persisted and survives compaction.</>, level: "beginner" },
      { name: "/clear", syntax: "/clear", description: <>Starts a fresh conversation. The previous session is saved and accessible via <C>/resume</C>.</>, when: "When you want to switch topics completely or start clean.", level: "beginner" },
      { name: "/model", syntax: "/model [name]", description: <>Switch models mid-session. Supports aliases: <C>sonnet</C>, <C>opus</C>, <C>haiku</C>, or full model names. Without an argument, shows a picker.</>, when: "When you want to switch between speed (Sonnet) and capability (Opus) mid-task.", level: "beginner" },
      { name: "/help", syntax: "/help", description: <>Shows all available slash commands and basic usage. Context-sensitive — shows different output depending on your current state.</>, when: "When you forget a command or want to discover new ones.", level: "beginner" },
      { name: "/status", syntax: "/status", description: <>Shows your Claude Code version, active model, account info, and connectivity. Works even while Claude is responding.</>, when: "Quick health check or to verify which model you're running.", level: "beginner" },
      { name: "/cost", syntax: "/cost", description: <>Shows token usage stats for the current session. Subscription-specific details if you're on a paid plan.</>, when: "When you want to know how much context you've used.", level: "beginner" },
      { name: "/context", syntax: "/context", description: <>Visualizes your context usage with optimization suggestions. Shows what's taking up space.</>, when: "When you suspect context bloat and want to know why before compacting.", level: "intermediate" },
    ],
  },
  {
    id: "cc-session",
    label: "Session Management",
    icon: MessageSquare,
    color: "#8b5cf6",
    items: [
      { name: "/resume", syntax: "/resume [session-id or name]", description: <>Continue a previous conversation. Shows a session picker if no argument given. Sessions are named and searchable.</>, when: "When you want to return to work from a previous session — even across machine restarts.", tips: <>From the CLI: <C>claude --resume SESSION_ID</C> or <C>claude -c</C> (most recent).</>, level: "beginner" },
      { name: "/branch", syntax: "/branch [name]", description: <>Branch the current conversation. The original session is preserved; you get a new fork from this point. Also available as <C>/fork</C>.</>, when: "When you want to try an alternative approach without losing the current one.", level: "intermediate" },
      { name: "/rename", syntax: "/rename [name]", description: <>Rename the current session. If no name given, Claude auto-generates one from the conversation history.</>, when: "When the default session name isn't descriptive enough for later /resume.", level: "beginner" },
      { name: "/export", syntax: "/export [filename]", description: <>Export the current session as a plaintext file. Opens a dialog if no filename given.</>, when: "When you want to share a conversation or keep an offline copy.", level: "intermediate" },
      { name: "/rewind", syntax: "/rewind", description: <>Restore conversation and code state to a previous checkpoint. Also triggered by pressing <K>Esc</K>+<K>Esc</K>. Claude auto-checkpoints at key moments.</>, when: "When Claude made changes you want to undo, including file edits.", tips: <>This is more powerful than git — it restores conversation state AND code state together.</>, level: "intermediate" },
      { name: "/recap", syntax: "/recap", description: <>Generate a summary of the current session. Also shows automatically when you return after 3+ minutes away.</>, when: "When you need a quick reminder of what happened so far.", level: "beginner" },
      { name: "/diff", syntax: "/diff", description: <>Interactive viewer showing git diffs and per-turn diffs. See exactly what changed and when.</>, when: "When you want to review all changes Claude made, organized by turn.", level: "intermediate" },
    ],
  },
  {
    id: "cc-workflow",
    label: "Advanced Workflows",
    icon: Zap,
    color: "#f59e0b",
    items: [
      { name: "/batch", syntax: "/batch <instruction>", description: <>Orchestrates 5–30 parallel agents, each in an isolated git worktree. Ideal for large-scale refactors across many files. Claude plans the work, spawns agents, and merges results.</>, when: "When you need to make similar changes across many files — like migrating an API across 20 endpoints.", tips: <>Requires git. Each agent works independently; merge conflicts are resolved at the end. Start with small batches to calibrate.</>, level: "advanced" },
      { name: "/simplify", syntax: "/simplify [focus area]", description: <>Spawns 3 parallel review agents examining your recent code for reuse opportunities, code quality issues, and efficiency improvements. Returns a consolidated report.</>, when: "After finishing a feature — get a quick second opinion on code quality.", level: "intermediate" },
      { name: "/loop", syntax: "/loop [interval] [prompt]", description: <>Runs a prompt repeatedly. Interval can be time-based (e.g., <C>5m</C>) or self-paced. Useful for polling, monitoring, or iterative tasks.</>, when: "When you need Claude to keep checking something — like waiting for a build to finish or monitoring test output.", tips: <>Self-paced mode lets Claude decide when to check next. Set a reasonable interval to avoid burning context.</>, level: "advanced" },
      { name: "/schedule", syntax: "/schedule [description]", description: <>Create, update, or list routines — cron-based automation that runs Claude commands on a schedule.</>, when: "When you want Claude to do something regularly — like daily code reviews or morning status reports.", level: "advanced" },
      { name: "/btw", syntax: "/btw <question>", description: <>Ask a side question without adding to the conversation history. Reuses the parent cache (low cost) but has no tool access.</>, when: "Quick factual question mid-task without polluting your main context.", level: "intermediate" },
      { name: "/review", syntax: "/review [PR number]", description: <>Review the current branch's PR. Analyzes changes, checks for bugs, suggests improvements. <C>/ultrareview</C> runs a deeper cloud-based analysis.</>, when: "Before merging a PR — get a thorough automated code review.", level: "intermediate" },
      { name: "/security-review", syntax: "/security-review", description: <>Scans the git diff for security vulnerabilities — injection, auth bypass, data exposure, etc.</>, when: "Before shipping code that handles user input, auth, or sensitive data.", level: "intermediate" },
      { name: "/autofix-pr", syntax: "/autofix-pr [prompt]", description: <>Cloud-based session that watches your current PR branch. Automatically fixes CI failures and addresses review comments.</>, when: "When CI is failing on a PR and you want Claude to fix it autonomously.", level: "advanced" },
    ],
  },
  {
    id: "cc-config",
    label: "Configuration",
    icon: Settings2,
    color: "#06b6d4",
    items: [
      { name: "/config", syntax: "/config", description: <>Opens an interactive settings panel. Configure model, theme, output style, editor mode (vim), prompt suggestions, and more. Also available as <C>/settings</C>.</>, when: "When you want to change Claude Code behavior — model, theme, vim mode, etc.", level: "beginner" },
      { name: "/permissions", syntax: "/permissions", description: <>Manage tool permission rules — allow, ask, or deny specific tools. Review what auto mode denied. See the current mode and switch.</>, when: "When you want to fine-tune which actions Claude can take without asking.", level: "intermediate" },
      { name: "/memory", syntax: "/memory", description: <>Edit your CLAUDE.md file and toggle auto-memory. CLAUDE.md is loaded into every session and serves as persistent project context.</>, when: "When you want to add persistent instructions, project conventions, or context for all future sessions.", tips: <>CLAUDE.md files cascade: <C>~/.claude/CLAUDE.md</C> (global) → <C>PROJECT/CLAUDE.md</C> (project) → <C>PROJECT/.claude/CLAUDE.md</C> (project-level).</>, level: "beginner" },
      { name: "/hooks", syntax: "/hooks", description: <>View hook configurations. Hooks are deterministic scripts triggered on events like <C>PreToolUse</C>, <C>PostToolUse</C>, <C>Stop</C>, <C>SessionStart</C>, <C>SessionEnd</C>.</>, when: "When you want to add custom automation — like running linters after every edit or logging tool calls.", level: "advanced" },
      { name: "/mcp", syntax: "/mcp", description: <>Manage MCP (Model Context Protocol) servers. Connect external tools and data sources to Claude — databases, APIs, browser automation, calendars, etc.</>, when: "When you want to give Claude access to external systems beyond the filesystem.", tips: <>Configured via <C>.mcp.json</C> at project root or <C>~/.claude/.mcp.json</C> globally. Supports stdio and HTTP transports.</>, level: "intermediate" },
      { name: "/plugin", syntax: "/plugin [install|list|uninstall]", description: <>Manage plugins. Plugins bundle skills, hooks, subagents, and MCP servers into a single installable package.</>, when: "When you find a community plugin that adds useful capabilities.", level: "intermediate" },
      { name: "/theme", syntax: "/theme", description: <>Change the color theme. Options include auto dark/light, daltonized (color-blind friendly), and various ANSI modes.</>, when: "When the default theme doesn't suit your terminal or preferences.", level: "beginner" },
      { name: "/keybindings", syntax: "/keybindings", description: <>Open or create your keybindings configuration file for custom keyboard shortcuts.</>, when: "When the default keyboard shortcuts conflict with your terminal or you want custom binds.", level: "advanced" },
    ],
  },
  {
    id: "cc-cli",
    label: "CLI Flags",
    icon: Terminal,
    color: "#10b981",
    items: [
      { name: "--print / -p", syntax: "claude -p \"query\"", description: <>Non-interactive mode. Send a query, get a response, exit. Essential for scripting and automation.</>, when: "When embedding Claude in scripts, cron jobs, or pipelines.", tips: <>Combine with <C>--output-format json</C> for machine-readable output. Add <C>--no-session-persistence</C> to avoid polluting the session list.</>, level: "intermediate" },
      { name: "--resume / -r / -c", syntax: "claude --resume SESSION_ID\nclaude -c", description: <><C>-r</C> resumes a specific session by ID or name. <C>-c</C> continues the most recent session.</>, when: "When resuming work from the terminal command line.", level: "beginner" },
      { name: "--model", syntax: "claude --model opus", description: <>Set the model at startup. Supports aliases (<C>sonnet</C>, <C>opus</C>, <C>haiku</C>) or full model IDs.</>, when: "When you want a specific model from the start.", level: "beginner" },
      { name: "--permission-mode", syntax: "claude --permission-mode auto", description: <>Start in a specific permission mode: <C>default</C>, <C>acceptEdits</C>, <C>plan</C>, <C>auto</C>, <C>dontAsk</C>, <C>bypassPermissions</C>.</>, when: "When you know upfront you want a specific trust level.", level: "intermediate" },
      { name: "--max-turns", syntax: "claude -p \"task\" --max-turns 10", description: <>Limit the number of agentic turns in print mode. Prevents runaway loops.</>, when: "When running automated tasks where you need a safety cap.", level: "intermediate" },
      { name: "--max-budget-usd", syntax: "claude -p \"task\" --max-budget-usd 5.00", description: <>Stop before exceeding a dollar spend threshold (print mode only).</>, when: "When you need hard cost controls on automated runs.", level: "intermediate" },
      { name: "--mcp-config", syntax: "claude --mcp-config path/to/config.json", description: <>Load MCP servers from a specific file instead of (or in addition to) the defaults.</>, when: "When running Claude in different environments that need different MCP setups.", level: "advanced" },
      { name: "--system-prompt", syntax: "claude -p \"task\" --system-prompt \"You are a reviewer\"", description: <>Replace or append to the system prompt. Use <C>--append-system-prompt</C> to add without replacing.</>, when: "When building specialized agents or tools on top of Claude Code.", level: "advanced" },
      { name: "--bare", syntax: "claude --bare -p \"task\"", description: <>Minimal startup — skips entity discovery and project scanning. Much faster for simple queries.</>, when: "When startup speed matters and you don't need project context.", level: "intermediate" },
      { name: "--worktree / -w", syntax: "claude -w feature-branch", description: <>Run in an isolated git worktree. Claude works on a separate copy of the repo — no risk to your main branch.</>, when: "When you want Claude to experiment freely without touching your working directory.", level: "advanced" },
    ],
  },
  {
    id: "cc-keyboard",
    label: "Keyboard Shortcuts",
    icon: Keyboard,
    color: "#ec4899",
    items: [
      { name: "Shift+Tab", syntax: "Shift+Tab", description: <>Cycle through permission modes: default → acceptEdits → plan → [auto/bypassPermissions if enabled].</>, when: "When you want to quickly change how much autonomy Claude has mid-session.", tips: <>Also available as <K>Alt</K>+<K>M</K>. The cycling order depends on which modes are enabled in your settings.</>, level: "beginner" },
      { name: "Ctrl+O", syntax: "Ctrl+O", description: <>Toggle the transcript viewer. Shows the full conversation with expanded tool calls and MCP responses. Press <K>Ctrl</K>+<K>E</K> inside to toggle all content.</>, when: "When you want to see what Claude actually did — every tool call, every file read, every bash command.", level: "beginner" },
      { name: "Alt+T / Option+T", syntax: "Alt+T (Win) / Option+T (Mac)", description: <>Toggle extended thinking. Claude shows its reasoning process before responding. Slower but better for complex problems.</>, when: "When facing a tricky bug or architectural decision — extended thinking helps Claude reason more carefully.", level: "intermediate" },
      { name: "Alt+O / Option+O", syntax: "Alt+O (Win) / Option+O (Mac)", description: <>Toggle fast mode. Uses the same model with faster output. No quality difference.</>, when: "When you want quicker responses for simpler tasks.", level: "beginner" },
      { name: "Alt+P / Option+P", syntax: "Alt+P (Win) / Option+P (Mac)", description: <>Switch model. Opens a model picker to change mid-session.</>, when: "When you want to switch between Opus and Sonnet without typing /model.", level: "beginner" },
      { name: "Ctrl+G", syntax: "Ctrl+G or Ctrl+X Ctrl+E", description: <>Open your current prompt in your default text editor. The previous response is shown as comments for reference. Great for long prompts.</>, when: "When you need to write a multi-paragraph prompt that's hard to compose in the terminal.", level: "intermediate" },
      { name: "Ctrl+R", syntax: "Ctrl+R", description: <>Reverse-search your command history. Type to find previous prompts interactively.</>, when: "When you want to re-run or modify a previous prompt.", level: "intermediate" },
      { name: "Esc + Esc", syntax: "Press Esc twice", description: <>Trigger rewind/checkpoint. Restore conversation and code to a previous state.</>, when: "When you want to undo Claude's last action, including file changes.", level: "intermediate" },
      { name: "! (prefix)", syntax: "! ls -la", description: <>Bash mode — run a shell command directly. Output becomes part of the conversation. Supports history-based autocomplete.</>, when: "When you want to run a quick command and show Claude the output.", level: "beginner" },
      { name: "@ (prefix)", syntax: "@src/main.ts", description: <>File mention — trigger autocomplete for file paths. Referenced files are loaded into context.</>, when: "When you want to point Claude at a specific file.", level: "beginner" },
      { name: "Ctrl+V / Cmd+V", syntax: "Ctrl+V or Cmd+V", description: <>Paste an image from your clipboard. Inserts as <C>[Image #N]</C> chip. Claude can analyze screenshots, diagrams, etc.</>, when: "When you want to show Claude a screenshot, error dialog, or design mockup.", level: "beginner" },
      { name: "Ctrl+T", syntax: "Ctrl+T", description: <>Toggle the task list. Track multi-step work that persists across compactions.</>, when: "When working on a complex task and you want to see progress.", level: "beginner" },
    ],
  },
  {
    id: "cc-modes",
    label: "Permission Modes",
    icon: Lock,
    color: "#6366f1",
    items: [
      { name: "Default", syntax: "Shift+Tab → Default", description: <>Claude can only read files and ask permission for everything else. The safest mode — you approve every write, every bash command.</>, when: "When working on sensitive code or you're learning what Claude does.", tips: <>This is the default for new installations. Switch up as you build trust.</>, level: "beginner" },
      { name: "Accept Edits", syntax: "Shift+Tab → Accept Edits", description: <>Auto-approves file reads AND file edits. Safe bash commands (<C>mkdir</C>, <C>touch</C>, <C>mv</C>, <C>cp</C>) are also auto-approved. Still asks for risky bash.</>, when: "The sweet spot for most development work. Claude edits freely, you review via git diff afterward.", level: "beginner" },
      { name: "Plan Mode", syntax: "Shift+Tab → Plan", description: <>Read-only — Claude can explore but only proposes changes as a plan document. Nothing is actually edited until you approve. Then you choose which execution mode to use.</>, when: "When you want to see the full plan before any code is touched. Great for unfamiliar codebases.", level: "beginner" },
      { name: "Auto Mode", syntax: "Shift+Tab → Auto", description: <>Auto-approves everything with a background safety classifier that checks each action. Requires Max, Team, or Enterprise plan with Sonnet/Opus 4.6+. Falls back after consecutive denials.</>, when: "When you're on a long autonomous task and trust the guardrails. Great with /batch and /loop.", tips: <>Research preview — the classifier blocks escalation, hostile content, and unrecognized infrastructure changes. Not a substitute for code review.</>, level: "advanced" },
      { name: "Bypass Permissions", syntax: "--dangerously-skip-permissions", description: <>Auto-approves everything with no classifier. Protected paths (<C>.git</C>, <C>.claude</C>) are still guarded. <b>Only use in isolated containers.</b></>, when: "CI/CD pipelines, Docker containers, or sandboxed environments where there's no host to protect.", tips: <>The name is intentionally scary. Never use on your host machine. Use <C>--allow-dangerously-skip-permissions</C> to merely add it to the Shift+Tab cycle without starting in it.</>, level: "advanced" },
    ],
  },
  {
    id: "cc-features",
    label: "Features & Concepts",
    icon: Sparkles,
    color: "#f97316",
    items: [
      { name: "Extended Thinking", syntax: "Alt+T to toggle", description: <>When enabled, Claude shows its chain-of-thought reasoning before responding. Takes longer but produces better results on complex problems — architecture decisions, tricky bugs, multi-step logic.</>, when: "For anything non-trivial. Especially debugging, planning, and code review.", tips: <>Costs more tokens. Toggle off for simple tasks. The thinking block is visible in Ctrl+O transcript view.</>, level: "intermediate" },
      { name: "Fast Mode", syntax: "Alt+O to toggle, or /fast", description: <>Uses the same model with faster response delivery. No quality downgrade — just optimized output streaming.</>, when: "When you're iterating quickly and want faster feedback.", level: "beginner" },
      { name: "CLAUDE.md Memory", syntax: "Edit via /memory", description: <>A markdown file loaded into every session. Acts as persistent project context — coding conventions, architecture notes, instructions. Cascades: <C>~/.claude/CLAUDE.md</C> (global) → <C>PROJECT/CLAUDE.md</C> → <C>.claude/CLAUDE.md</C>.</>, when: "To give Claude persistent knowledge about your project that it should always have.", tips: <>Keep it focused. Everything in CLAUDE.md counts against your context window every turn. Trim what's not essential.</>, level: "beginner" },
      { name: "MCP Servers", syntax: "/mcp or .mcp.json", description: <>Model Context Protocol — connect Claude to external tools and data sources. Databases, calendars, email, browser automation, design tools, and more. Configured via JSON, supports stdio and HTTP transports.</>, when: "When you need Claude to interact with systems beyond the filesystem — APIs, databases, SaaS tools.", tips: <>Community MCP servers exist for most popular tools. Check <C>context7</C> for library docs, <C>playwright</C> for browser control.</>, level: "intermediate" },
      { name: "Hooks", syntax: "/hooks or settings.json", description: <>Deterministic scripts triggered by events: <C>PreToolUse</C> (before), <C>PostToolUse</C> (after), <C>Stop</C>, <C>SessionStart</C>, <C>SessionEnd</C>. Run linters after edits, log tool calls, block dangerous commands, etc.</>, when: "When you want automated guardrails or post-processing on Claude's actions.", level: "advanced" },
      { name: "Subagents", syntax: "--agents or .claude/agents/", description: <>Spawn isolated context workers that run a focused task and return a summary. Each agent has its own context window. Define via markdown frontmatter, CLI JSON, or the <C>.claude/agents/</C> directory.</>, when: "When a task benefits from parallel or isolated exploration — like researching while you code.", level: "advanced" },
      { name: "Context Compaction", syntax: "/compact [focus]", description: <>Claude summarizes the conversation to reclaim context space. Focus instructions guide what's preserved. Previous uncompacted state remains accessible via <C>/resume</C>.</>, when: "When the context bar is getting full (check with Ctrl+O or /context) and you need more room.", tips: <>Compaction is lossy. Very specific details may be lost. Mention what's important in the focus argument.</>, level: "beginner" },
      { name: "Git Worktrees", syntax: "claude -w branch-name", description: <>Claude works in an isolated copy of your repo. All changes happen in a separate git worktree — your main branch is untouched. Results can be merged back when ready.</>, when: "When you want Claude to experiment freely on a feature branch without risking your working directory.", level: "advanced" },
      { name: "Voice Dictation", syntax: "/voice to enable", description: <>Push-to-talk voice input. Hold <K>Space</K> to record, release to send. Claude transcribes and processes your speech.</>, when: "When typing is inconvenient or you think better by talking.", level: "intermediate" },
      { name: "Vim Mode", syntax: "/config → Editor mode", description: <>Full vim keybindings in the prompt input. NORMAL mode, INSERT mode, text objects, motions — the full experience.</>, when: "If you're a vim user and want muscle-memory navigation in the prompt.", level: "intermediate" },
      { name: "Remote Control", syntax: "/remote-control or --rc", description: <>Connect your terminal session to claude.ai for web-based interaction. Control your local Claude Code from a browser on any device.</>, when: "When you want to interact with your local Claude from a phone, tablet, or different machine.", level: "advanced" },
      { name: "Prompt Suggestions", syntax: "Tab or Right arrow to accept", description: <>Grayed-out follow-up suggestions appear based on conversation history. Press <K>Tab</K> to accept, or just type to ignore. Auto-skips after the first turn.</>, when: "When you're not sure what to ask next — the suggestions often surface useful follow-ups.", level: "beginner" },
    ],
  },
];

// -----------------------------------------------------------------------------
// First 5 Minutes — linear walkthrough
// -----------------------------------------------------------------------------

type FirstStep = {
  n: number;
  title: string;
  body: React.ReactNode;
  cta?: { label: string; onClick: () => void };
};

// -----------------------------------------------------------------------------
// Helpers for search and highlighting
// -----------------------------------------------------------------------------

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(" ");
  if (typeof node === "object" && "props" in (node as any)) {
    return extractText((node as any).props.children);
  }
  return "";
}

// Search body text for a topic. Prefers the explicit searchText field when
// authors supply it; falls back to walking the ReactNode tree.
function topicBodyText(topic: Topic): string {
  return topic.searchText ?? extractText(topic.a);
}

// Rank a topic against a query. Lower is better. Used for search ranking so
// exact-title matches beat partial body matches.
// 0 = exact title, 1 = title starts-with, 2 = title contains, 3 = body contains, 99 = no match.
function rankTopic(topic: Topic, q: string): number {
  if (!q) return 0;
  const qLower = q.toLowerCase();
  const qTitle = topic.q.toLowerCase();
  if (qTitle === qLower) return 0;
  if (qTitle.startsWith(qLower)) return 1;
  if (qTitle.includes(qLower)) return 2;
  if (topicBodyText(topic).toLowerCase().includes(qLower)) return 3;
  return 99;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-blue-500/25 text-foreground rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// -----------------------------------------------------------------------------
// URL hash parsing
// -----------------------------------------------------------------------------

type TabId = "first-5-minutes" | "browse" | "glossary" | "cheat-sheet" | "claude-code";

export function parseHash(hash: string): {
  tab: TabId;
  category?: string;
  topicIndex?: number;
  topicSlug?: string;
  query?: string;
} {
  // Strip ALL leading # characters — browsers sometimes produce /help## when
  // setting an empty hash, and a single-strip leaves "#foo" which then
  // pollutes activeCategory.
  const raw = hash.replace(/^#+/, "").trim();
  if (!raw) return { tab: "browse" };
  if (raw === "first-5-minutes") return { tab: "first-5-minutes" };
  if (raw === "glossary") return { tab: "glossary" };
  if (raw === "cheat-sheet") return { tab: "cheat-sheet" };
  if (raw === "claude-code" || raw.startsWith("cc-")) return { tab: "claude-code" };
  if (raw.startsWith("q=")) {
    try {
      return { tab: "browse", query: decodeURIComponent(raw.slice(2)) };
    } catch {
      return { tab: "browse" };
    }
  }
  const [cat, topic] = raw.split(":");
  const validCat = CATEGORIES.some((c) => c.id === cat) ? cat : undefined;
  if (!validCat) return { tab: "browse" };
  if (topic == null) return { tab: "browse", category: validCat };
  // Topic specifier can be either a numeric index (back-compat with v2.0
  // /help#sessions:3 deep-links) or a slug string (/help#sessions:what-is-a-session).
  const asNum = Number(topic);
  if (!Number.isNaN(asNum) && /^\d+$/.test(topic.trim())) {
    return { tab: "browse", category: validCat, topicIndex: asNum };
  }
  return { tab: "browse", category: validCat, topicSlug: topic };
}

// Resolve a parsed topic specifier to its stable slug key. Returns null if the
// category has no such topic (invalid deep-link).
function resolveTopicKey(
  categoryId: string | undefined,
  topicIndex: number | undefined,
  topicSlug: string | undefined,
): { key: string; topic: Topic } | null {
  if (!categoryId) return null;
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  if (topicIndex != null) {
    const topic = cat.topics[topicIndex];
    if (!topic) return null;
    return { key: topicKey(categoryId, topic), topic };
  }
  if (topicSlug) {
    const topic = cat.topics.find((t) => slugifyTopic(t.q) === topicSlug);
    if (!topic) return null;
    return { key: topicKey(categoryId, topic), topic };
  }
  return null;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function HelpCenter() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<TabId>("browse");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"beginner" | "all" | "advanced">("all");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterResetNotice, setFilterResetNotice] = useState<string | null>(null);
  const hashWriteTimer = useRef<ReturnType<typeof setTimeout>>();

  // Shared resolver — applies a parsed hash to component state, including
  // auto-resetting the difficulty filter if it would hide the deep-linked topic.
  const applyParsedHash = useCallback((p: ReturnType<typeof parseHash>) => {
    setTab(p.tab);
    if (p.query) setQuery(p.query);
    if (!p.category) return;
    setActiveCategory(p.category);
    const resolved = resolveTopicKey(p.category, p.topicIndex, p.topicSlug);
    if (!resolved) return;
    setExpanded(new Set([resolved.key]));
    setLevelFilter((current) => {
      if (isLevelVisible(resolved.topic.level, current)) return current;
      setFilterResetNotice(
        `Showing all difficulties so this ${resolved.topic.level} topic is visible.`,
      );
      return "all";
    });
    // Scroll into view after the filter/expand state has rendered.
    setTimeout(() => {
      const el = document.querySelector(`[data-help-topic="${resolved.key}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, []);

  // --- Read hash on mount ---------------------------------------------------
  useEffect(() => {
    applyParsedHash(parseHash(window.location.hash));
    const onHashChange = () => applyParsedHash(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyParsedHash]);

  // --- Write hash on state change (debounced) -------------------------------
  useEffect(() => {
    if (hashWriteTimer.current) clearTimeout(hashWriteTimer.current);
    hashWriteTimer.current = setTimeout(() => {
      let newHash = "";
      if (tab === "first-5-minutes") newHash = "#first-5-minutes";
      else if (tab === "glossary") newHash = "#glossary";
      else if (tab === "cheat-sheet") newHash = "#cheat-sheet";
      else if (tab === "browse") {
        if (query) newHash = `#q=${encodeURIComponent(query)}`;
        else if (activeCategory) newHash = `#${activeCategory}`;
      }
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", window.location.pathname + newHash);
      }
    }, 300);
    return () => { if (hashWriteTimer.current) clearTimeout(hashWriteTimer.current); };
  }, [tab, query, activeCategory]);

  // --- Level filtering + search --------------------------------------------
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const order = { beginner: 0, intermediate: 1, advanced: 2 } as const;
    return CATEGORIES.map((cat) => ({
      ...cat,
      topics: cat.topics
        .filter((t) => isLevelVisible(t.level, levelFilter))
        .map((t) => ({ t, rank: rankTopic(t, q) }))
        .filter(({ rank }) => rank < 99)
        .sort((a, b) => {
          // When searching, rank wins so exact-title matches float to the top.
          // Otherwise, keep the established beginner-first-within-category order.
          if (q) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return order[a.t.level] - order[b.t.level];
          }
          return order[a.t.level] - order[b.t.level];
        })
        .map(({ t }) => t),
    })).filter((cat) => cat.topics.length > 0);
  }, [q, levelFilter]);

  // Glossary filtering
  const glossaryVisible = useMemo(() => {
    if (!q) return GLOSSARY;
    return GLOSSARY.filter((g) =>
      g.term.toLowerCase().includes(q) || extractText(g.definition).toLowerCase().includes(q)
    );
  }, [q]);

  // --- First 5 Minutes helpers ---------------------------------------------
  const triggerGlobalSearch = useCallback(() => {
    // Blur whatever has focus (typically this page's own Search input) so the
    // synthetic Ctrl+K keystroke is interpreted by GlobalSearch, not stolen
    // by the input we're dispatching from.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }, []);

  const totalVisibleTopics = visible.reduce((sum, c) => sum + c.topics.length, 0);

  const toggleTopic = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- First 5 Minutes walkthrough data (needs setLocation/etc. in closure) -
  const firstSteps: FirstStep[] = [
    {
      n: 1,
      title: "What Command Center is (30 seconds)",
      body: <>A local dashboard that reads everything under <C>~/.claude/</C> and shows it in one place: projects, sessions, MCPs, skills, plugins, costs, and the relationships between them. Runs on <C>127.0.0.1:5100</C>. Nothing leaves your machine.</>,
    },
    {
      n: 2,
      title: "Force a fresh scan",
      body: <>The Dashboard has a Rescan button in the top-right that walks every directory and rebuilds the entity graph. Click it any time the counts look wrong.</>,
      cta: { label: "Go to Dashboard", onClick: () => setLocation("/") },
    },
    {
      n: 3,
      title: "Open global search",
      body: <>Press <K>Ctrl</K>+<K>K</K> from any page. Type a few characters of a session title, project name, or file. Arrow keys to select, Enter to jump.</>,
      cta: { label: "Open Ctrl+K now", onClick: triggerGlobalSearch },
    },
    {
      n: 4,
      title: "Explore the Graph",
      body: <>The Graph page shows every entity and relationship. Click a node to see its blast radius — all the other entities that depend on it, reachable via BFS. If pan/zoom feels slow, hide the MiniMap from the toolbar.</>,
      cta: { label: "Go to Graph", onClick: () => setLocation("/graph") },
    },
    {
      n: 5,
      title: "Watch a session live",
      body: <>Live View polls every 3 seconds for active Claude Code sessions. Watch the context bar fill up in real time; click the purple Compact button if you need to free up space without ending the session.</>,
      cta: { label: "Go to Live", onClick: () => setLocation("/live") },
    },
    {
      n: 6,
      title: "Where to go next",
      body: <>Browse the full Help by category, look up jargon in the Glossary, or grab keyboard shortcuts and URL tricks from the Cheat Sheet.</>,
    },
  ];

  // -------------------------------------------------------------------------
  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10">
            <LifeBuoy className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Help Center</h1>
            <p className="text-sm text-muted-foreground">
              Answers for beginners and advanced users. Everything in Command Center, explained.
            </p>
          </div>
        </div>
        {/* Level filter */}
        <div
          className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5 shrink-0"
          role="radiogroup"
          aria-label="Difficulty filter"
        >
          {(["beginner", "all", "advanced"] as const).map((lvl) => (
            <button
              key={lvl}
              role="radio"
              aria-checked={levelFilter === lvl}
              onClick={() => {
                setLevelFilter(lvl);
                setFilterResetNotice(null);
              }}
              className={`px-3 py-1 text-xs rounded-sm transition-colors capitalize ${
                levelFilter === lvl
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Search — visible across all tabs */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search topics, glossary, and cheat sheet…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Clear active category when typing — otherwise a stale selection
            // re-activates once the search is cleared, confusing the user.
            if (e.target.value) setActiveCategory(null);
          }}
          className="pl-9 h-10"
          autoFocus
          aria-label="Search help topics"
        />
      </div>

      {filterResetNotice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3">
          <span>{filterResetNotice}</span>
          <button
            type="button"
            onClick={() => setFilterResetNotice(null)}
            className="text-amber-300/70 hover:text-amber-200 text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList className="grid grid-cols-5 w-full max-w-[700px]">
          <TabsTrigger value="first-5-minutes" className="text-xs">
            <Rocket className="h-3.5 w-3.5 mr-1.5" /> First 5 Min
          </TabsTrigger>
          <TabsTrigger value="browse" className="text-xs">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" /> Browse
          </TabsTrigger>
          <TabsTrigger value="claude-code" className="text-xs">
            <Terminal className="h-3.5 w-3.5 mr-1.5" /> Claude Code
          </TabsTrigger>
          <TabsTrigger value="glossary" className="text-xs">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Glossary
          </TabsTrigger>
          <TabsTrigger value="cheat-sheet" className="text-xs">
            <Keyboard className="h-3.5 w-3.5 mr-1.5" /> Cheat Sheet
          </TabsTrigger>
        </TabsList>

        {/* -------- First 5 Minutes -------- */}
        <TabsContent value="first-5-minutes" className="space-y-4 pt-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Rocket className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold">Your first five minutes</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Six quick steps. Each has a button that actually does the thing — no reading required.
            </p>
          </div>
          <div className="space-y-3">
            {firstSteps.map((s) => (
              <div key={s.n} className="rounded-xl border bg-card p-5 flex gap-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/15 text-blue-400 font-semibold text-sm shrink-0">
                  {s.n}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold mb-1">{s.title}</h3>
                  <div className="text-sm text-foreground/80 leading-relaxed mb-3">{s.body}</div>
                  {s.cta && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={s.cta.onClick}>
                      {s.cta.label}
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* -------- Browse -------- */}
        <TabsContent value="browse" className="space-y-4 pt-4">
          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory(null)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeCategory === null ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : "border-border hover:bg-muted"
              }`}
            >
              All ({CATEGORIES.reduce((s, c) => s + c.topics.length, 0)})
            </button>
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const active = activeCategory === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(active ? null : c.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                    active ? "text-white" : "hover:bg-muted"
                  }`}
                  style={active ? { backgroundColor: c.color, borderColor: c.color } : { borderColor: "hsl(var(--border))" }}
                >
                  <Icon className="h-3 w-3" />
                  {c.label}
                  <Badge variant="outline" className="ml-0.5 text-[9px] px-1 py-0 h-4 border-0 bg-black/20">
                    {c.topics.length}
                  </Badge>
                </button>
              );
            })}
          </div>

          {q && (
            <p className="text-xs text-muted-foreground">
              {totalVisibleTopics} match{totalVisibleTopics !== 1 ? "es" : ""} for "{query}"
            </p>
          )}

          {visible.filter((c) => !activeCategory || c.id === activeCategory).length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
              No topics match your current filters. Try clearing the search or switching to "All".
            </div>
          ) : (
            <div className="space-y-6">
              {visible
                .filter((c) => !activeCategory || c.id === activeCategory)
                .map((category) => {
                  const Icon = category.icon;
                  return (
                    <section key={category.id} id={category.id} className="rounded-xl border bg-card overflow-hidden">
                      <header className="flex items-center gap-3 px-5 py-4 border-b border-border/50">
                        <div
                          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
                          style={{ backgroundColor: `${category.color}15` }}
                        >
                          <Icon className="h-4 w-4" style={{ color: category.color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-semibold">{category.label}</h2>
                          <p className="text-xs text-muted-foreground">{category.description}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {category.topics.length} topic{category.topics.length !== 1 ? "s" : ""}
                        </Badge>
                      </header>
                      <div className="divide-y divide-border/40">
                        {category.topics.map((topic) => {
                          const key = topicKey(category.id, topic);
                          const isOpen = expanded.has(key) || !!q;
                          const lvl = LEVEL_STYLE[topic.level];
                          return (
                            <article key={key} data-help-topic={key}>
                              <button
                                type="button"
                                onClick={() => toggleTopic(key)}
                                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/30 transition-colors"
                                aria-expanded={isOpen}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span
                                  className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-background shrink-0 ${lvl.dot}`}
                                  title={`${topic.level[0].toUpperCase()}${topic.level.slice(1)}`}
                                >
                                  {lvl.label}
                                </span>
                                <span className="text-sm font-medium flex-1">
                                  {highlight(topic.q, query)}
                                </span>
                              </button>
                              {isOpen && (
                                <div className="px-5 pb-4 pl-[68px] text-sm text-foreground/80 leading-relaxed">
                                  {topic.a}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
            </div>
          )}
        </TabsContent>

        {/* -------- Claude Code Guide -------- */}
        <TabsContent value="claude-code" className="space-y-6 pt-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold">Claude Code CLI Reference</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Every command, shortcut, mode, and feature in Claude Code — explained with syntax, when to use it, and tips.
              {q && <> Showing matches for "{query}".</>}
            </p>
          </div>

          {CLI_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const filtered = cat.items.filter((item) => {
              if (!isLevelVisible(item.level, levelFilter)) return false;
              if (!q) return true;
              const rank = (() => {
                const name = item.name.toLowerCase();
                const ql = q;
                if (name === ql) return 0;
                if (name.includes(ql)) return 1;
                if (item.syntax.toLowerCase().includes(ql)) return 2;
                if (item.when.toLowerCase().includes(ql)) return 3;
                if (extractText(item.description).toLowerCase().includes(ql)) return 4;
                if (item.tips && extractText(item.tips).toLowerCase().includes(ql)) return 5;
                return 99;
              })();
              return rank < 99;
            });
            if (filtered.length === 0) return null;
            return (
              <section key={cat.id} className="rounded-xl border bg-card overflow-hidden">
                <header className="flex items-center gap-3 px-5 py-4 border-b border-border/50">
                  <div
                    className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
                    style={{ backgroundColor: `${cat.color}15` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: cat.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">{cat.label}</h2>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {filtered.length} item{filtered.length !== 1 ? "s" : ""}
                  </Badge>
                </header>
                <div className="divide-y divide-border/40">
                  {filtered.map((item) => {
                    const key = `cc-${cat.id}-${item.name}`;
                    const isOpen = expanded.has(key) || !!q;
                    const lvl = LEVEL_STYLE[item.level];
                    return (
                      <article key={key} data-help-topic={key}>
                        <button
                          type="button"
                          onClick={() => toggleTopic(key)}
                          className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/30 transition-colors"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span
                            className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-background shrink-0 ${lvl.dot}`}
                            title={`${item.level[0].toUpperCase()}${item.level.slice(1)}`}
                          >
                            {lvl.label}
                          </span>
                          <code className="text-[12px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5 shrink-0">
                            {highlight(item.name, query)}
                          </code>
                          <span className="text-xs text-muted-foreground/70 flex-1 truncate">
                            {item.when}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4 pl-[68px] space-y-2">
                            <div className="text-sm text-foreground/80 leading-relaxed">{item.description}</div>
                            <div className="text-xs">
                              <span className="text-muted-foreground/60 uppercase tracking-wider text-[10px]">Syntax</span>
                              <pre className="mt-1 font-mono text-[11px] text-blue-300 bg-blue-500/10 rounded-md px-3 py-2 whitespace-pre-wrap">{item.syntax}</pre>
                            </div>
                            {item.tips && (
                              <div className="text-xs text-muted-foreground/70 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                                <span className="text-amber-400 font-medium text-[10px] uppercase tracking-wider">Tip</span>
                                <div className="mt-0.5">{item.tips}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {CLI_CATEGORIES.every((cat) => cat.items.filter((item) => isLevelVisible(item.level, levelFilter) && (q ? extractText(item.description).toLowerCase().includes(q) || item.name.toLowerCase().includes(q) : true)).length === 0) && (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
              No items match your current filters. Try clearing the search or switching to "All".
            </div>
          )}
        </TabsContent>

        {/* -------- Glossary -------- */}
        <TabsContent value="glossary" className="space-y-4 pt-4">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold">Glossary</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Every Command Center term, defined in one sentence. {q && <>Showing <strong>{glossaryVisible.length}</strong> match{glossaryVisible.length !== 1 ? "es" : ""} for "{query}".</>}
            </p>
          </div>
          {glossaryVisible.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
              No terms match "{query}".
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {glossaryVisible.map((g) => (
                <div key={g.term} className="rounded-lg border bg-card p-4">
                  <div className="font-mono text-xs font-semibold text-blue-400 mb-1">
                    {highlight(g.term, query)}
                  </div>
                  <div className="text-xs text-foreground/80 leading-relaxed">{g.definition}</div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* -------- Cheat Sheet -------- */}
        <TabsContent value="cheat-sheet" className="space-y-6 pt-4">
          {/* Keyboard shortcuts */}
          <section className="rounded-xl border bg-card overflow-hidden">
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border/50">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 bg-purple-500/15">
                <Keyboard className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
                <p className="text-xs text-muted-foreground">Every global keybinding. Press <K>?</K> for the compact overlay.</p>
              </div>
            </header>
            <div className="p-5 space-y-5">
              {CHEAT_SHORTCUTS.map((section) => (
                <div key={section.title}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{section.title}</h3>
                    {section.hint && <span className="text-[10px] text-muted-foreground/50">{section.hint}</span>}
                  </div>
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
                    {section.items.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-foreground/80">{item.label}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {item.keys.map((key, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <span className="text-[10px] text-muted-foreground/40">+</span>}
                              <K>{key}</K>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* URL params */}
          <section className="rounded-xl border bg-card overflow-hidden">
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border/50">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 bg-blue-500/15">
                <ExternalLink className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">URL parameters</h2>
                <p className="text-xs text-muted-foreground">Shortcuts hidden in the address bar. All copyable.</p>
              </div>
            </header>
            <div className="divide-y divide-border/40">
              {CHEAT_URL_PARAMS.map((row) => (
                <div key={row.url} className="flex items-start gap-4 px-5 py-3">
                  <code className="text-[11px] font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1 shrink-0">
                    {row.url}
                  </code>
                  <span className="text-xs text-foreground/80 pt-1.5">{row.effect}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Env vars */}
          <section className="rounded-xl border bg-card overflow-hidden">
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border/50">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 bg-green-500/15">
                <SlidersHorizontal className="h-4 w-4 text-green-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Environment variables</h2>
                <p className="text-xs text-muted-foreground">Set in your shell before starting the server. Unset means the feature is off, not broken.</p>
              </div>
            </header>
            <div className="divide-y divide-border/40">
              {CHEAT_ENV_VARS.map((row) => (
                <div key={row.name} className="grid grid-cols-12 gap-3 px-5 py-3 items-start">
                  <code className="col-span-3 text-[11px] font-mono text-green-300 bg-green-500/10 rounded px-2 py-1">{row.name}</code>
                  <span className="col-span-6 text-xs text-foreground/80 pt-1.5">{row.purpose}</span>
                  <code className="col-span-3 text-[11px] font-mono text-muted-foreground text-right pt-1.5 truncate">{row.default}</code>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Check className="h-4 w-4 text-green-400" />
          <span>{CATEGORIES.reduce((s, c) => s + c.topics.length, 0)} topics · {CLI_CATEGORIES.reduce((s, c) => s + c.items.length, 0)} CLI items · {GLOSSARY.length} glossary terms · verified against source</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/sorlen008/claude-command-center/issues"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:underline"
          >
            Open an issue
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
