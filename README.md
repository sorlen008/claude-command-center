<div align="center">

# Claude Command Center

**See everything Claude Code knows — projects, MCP servers, sessions, costs — in one dashboard.**

[![CI](https://github.com/sorlen008/claude-command-center/actions/workflows/ci.yml/badge.svg)](https://github.com/sorlen008/claude-command-center/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Works with Claude Code](https://img.shields.io/badge/Works%20with-Claude%20Code%202.x-blueviolet?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJMMyAyMGgyMEwxMiAyeiIvPjwvc3ZnPg==)](https://docs.anthropic.com/en/docs/claude-code)

[Setup Guide](SETUP.md) | [Security](SECURITY.md) | [Contributing](CONTRIBUTING.md) | [Roadmap](ROADMAP.md) | [Changelog](CHANGELOG.md)

</div>

---

A local dashboard for visualizing and managing your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ecosystem. Auto-discovers your projects, MCP servers, skills, plugins, sessions, agents, and their relationships with zero configuration.

### Why?

- **"How much am I spending on Claude Code?"** -- Cost analytics by session, project, model, and day. Set a monthly budget and get 80%/100% alerts. Opus→Sonnet savings recommendations.
- **"Which MCP servers are configured where?"** -- Auto-discovers every `.mcp.json` across all projects. One view, zero setup. Stack-aware recommendations for what's missing.
- **"I had a session last week that fixed this exact bug..."** -- Deep search across all session content. Find any conversation by what was said, not just the title.
- **"What was I working on yesterday?"** -- Continuation intelligence detects unfinished work and generates context prompts to resume instantly.
- **"I have 300+ sessions eating disk space."** -- Stale detection, bulk delete, and health scores help you clean up. Pinned sessions survive bulk delete.
- **"My graph has 1000+ edges and looks like spaghetti."** -- Focus Lens shows one node's neighborhood at a time in a clean radial layout, with a searchable picker for any entity in the full graph.

<p align="center">
  <img src="docs/demo.gif" alt="Claude Command Center Demo" width="800">
</p>

### What you get

| | |
|---|---|
| **Dashboard** -- entity counts, monthly budget, insights, system health, quick actions | **Sessions** -- deep search, AI summaries, pins, notes, HTML export, delegation |
| **Live View** -- real-time sessions with context bars, compact button, cost ticker | **Analytics** -- daily cost charts, model breakdown, CSV export, budget tracking |
| **Graph** -- Focus Lens, 6 view modes, blast radius, custom nodes, AI suggestions | **MCP Servers** -- auto-discovered, categorized, with stack-based recommendations |
| **Help Center** -- 107 topics, glossary, cheat sheet, first-5-minutes walkthrough | **Prompts** -- save and reuse effective prompt templates with tags |

---

## Quick Start

```bash
# Clone and run (3 commands)
git clone https://github.com/sorlen008/claude-command-center.git
cd claude-command-center
npm install && npm run dev
```

Open [http://localhost:5100](http://localhost:5100). Done. Everything is auto-discovered from your `~/.claude/` directory — no configuration needed.

> **Tip:** Keep it running in the background while you work in Claude Code. The dashboard auto-refreshes every 3 seconds.

See [SETUP.md](SETUP.md) for npm global install, production builds, and troubleshooting.

## Requirements

- **Node.js 18+** (tested on 20, 22, 24)
- **Claude Code** installed -- the dashboard reads from `~/.claude/` which Claude Code creates
- **git** -- required for the update feature (optional otherwise)

## Features

- **Auto-discovers** all Claude Code projects, MCP servers, skills, plugins, and markdown files
- **Help Center** -- four-tab learning surface with 107 topics, 49-term glossary, cheat sheet, first-5-minutes walkthrough, per-topic beginner/advanced difficulty filter, URL-hash deep-linking
- **Session intelligence** -- deep search, AI summaries, cost analytics, file heatmap, session health scores, HTML export
- **Automated insights** -- cost-spike detection, Opus→Sonnet savings suggestions, stale session alerts, duplicate-work detection, budget warnings
- **Monthly budget planner** -- set a spend cap, watch it on the Dashboard, get 80% and 100% alerts
- **Graph Focus Lens** -- survival mode for dense graphs (200+ nodes): shows a focus node + its neighborhood in a clean radial layout, searchable focus picker, escape hatch to show all
- **Graph visualization** -- 6 view modes (force / tiles / tree / list / radial / matrix), blast radius, custom nodes via `graph-config.yaml`, AI-assisted suggestions
- **MCP recommendations** -- analyzes project tech stack and suggests matching MCPs from the catalog
- **Operations nerve center** -- real-time service health, cost pacing, attention items, overnight activity
- **Continuation intelligence** -- detects unfinished work, uncommitted changes, abandoned sessions
- **Bash knowledge base** -- every shell command indexed and searchable with success rates and failure hotspots
- **Decision log** -- AI-extracted architectural decisions with alternatives and trade-offs
- **Natural language query** -- ask questions about your analytics data ("Which project costs the most?")
- **Session delegation** -- continue sessions via terminal, Telegram, or voice (cross-platform)
- **Project dashboards** -- per-project cost, health, files, and session aggregation
- **Prompt library** -- save and reuse effective prompt templates
- **Agent tracker** -- definitions and execution history across sessions
- **Live view** -- real-time monitoring with context bars, compact button, click-to-open in Sessions, cost ticker
- **Markdown editor** -- edit `CLAUDE.md` and memory files with autosave, version history, drift analyzer, overlap detection
- **Discovery** -- finds unconfigured projects and MCP servers on disk
- **One-click updates** -- check and apply updates from the sidebar
- **Mobile-responsive** -- sidebar collapses below 768px, accessibility labels throughout

## Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Entity counts, monthly budget, automated insights, usage card, quick stats |
| **Projects** | Discovered projects with session counts, tech stack, per-project dashboards |
| **MCP Servers** | Every MCP server found in `.mcp.json` files, categorized, with stack-aware recommendations |
| **Skills** | Auto-categorized by inferred keywords (devops, quality, docs, ai, etc.), favoriting, grouping |
| **Plugins** | Installed plugins with their bundled commands, agents, skills, and hooks |
| **Markdown** | `CLAUDE.md`, memory files, READMEs — autosave editor, version history, drift analyzer, overlap detection |
| **Sessions** | Deep search (three modes), AI summaries, pins, notes, HTML export, bulk delete with undo, delegation |
| **Agents** | Agent definitions, execution history, stats, learn guide |
| **Live** | Real-time sessions with context bars, compact button, click-to-open in Sessions |
| **Graph** | Interactive node graph — Focus Lens default, 6 view modes, blast radius, custom nodes, AI suggest |
| **Prompts** | Reusable prompt templates with tags and favorites |
| **Messages** | Cross-session message timeline with content search |
| **APIs** | External APIs from `apis-config.yaml`, env files, and Docker Compose |
| **Activity & Discovery** | File-change timeline plus auto-detected infrastructure (Docker, git remotes, env URLs) |
| **Stats** | Cost analytics, daily charts, model breakdown, CSV export, weekly digest |
| **Settings** | Path config, app name, monthly budget, entity overrides, themes |
| **Help Center** | 107 topics across 15 categories, glossary, cheat sheet, first-5-minutes walkthrough |

## Session Intelligence

The Sessions page includes a full **Analytics** tab with:

- **Cost Analytics** -- total spend, per-model/project/day breakdowns, most expensive sessions
- **File Heatmap** -- most-touched files with read/edit/write counts, clickable for cross-session timeline
- **Session Health** -- tool error and retry pattern detection (good/fair/poor scoring)
- **Bash Knowledge Base** -- searchable index of every shell command with success rates
- **Decision Log** -- AI-extracted architectural decisions from past sessions
- **Operations Nerve Center** -- configurable service monitoring, cost pacing, attention items
- **Continuation Intelligence** -- unfinished work detection with one-click resume
- **Smart Context Loader** -- generates context prompts from recent session summaries
- **Natural Language Query** -- ask questions about your data using Claude Haiku
- **Prompt Library** -- save reusable templates with one-click copy
- **Weekly Digest** -- automated weekly summary with accomplishments
- **Auto-Workflows** -- configurable auto-summarize, stale detection, cost alerts

## Security and Privacy

**This tool runs entirely on your local machine.**

| Concern | Details |
|---------|---------|
| **File system** | Reads `~/.claude/` and project directories. Writes only to `~/.claude-command-center/` and markdown files you explicitly edit. |
| **Shell commands** | Spawns `claude -p`, `git`, platform file openers, terminal emulators. All user input validated with Zod. |
| **Network** | Binds to `127.0.0.1` only. No outbound requests unless you use Discovery search or AI Suggest. |
| **Data** | All data stored locally as plain JSON. No cloud sync, no external databases. |
| **Telemetry** | None. No analytics, no tracking, no phone-home. |
| **Secrets** | Never stored. Scanned env vars with "secret", "password", "token", "key" are redacted to `***`. |

See [docs/security-threat-model.md](docs/security-threat-model.md) for the full threat model.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5100` | Server port |
| `HOST` | `127.0.0.1` | Bind address. **Do not set to `0.0.0.0`** -- no authentication. |
| `COMMAND_CENTER_DATA` | `~/.claude-command-center/` | Data directory |
| `GITHUB_TOKEN` | (none) | Optional. GitHub API rate limits for Discovery. |
| `NERVE_CENTER_SERVICES` | `Command Center:5100` | Services to monitor (`name:port,name:port`). |
| `VOICE_CALLER_SCRIPT` | (disabled) | Path to voice outbound caller script for delegation. |
| `VOICE_PHONE` | (disabled) | Phone number for voice delegation. |

## Graph Configuration

Extend the auto-discovered graph with custom nodes via `graph-config.yaml`:

```yaml
nodes:
  - id: my-database
    type: database
    label: "PostgreSQL"
    description: "Primary database on :5432"

edges:
  - source: my-mcp-server
    target: config-my-database
    label: connects_to
```

Place in `~/`, `~/.claude/`, or any project directory. See [SETUP.md](SETUP.md#graph-configuration) for details.

**AI Suggest** -- click the button in the graph toolbar to get AI-generated suggestions for infrastructure nodes and connections. Requires Claude Code CLI.

## Building and Updating

```bash
npm run build    # Bundle client (Vite) + server (esbuild)
npm start        # Run production bundle
```

The sidebar shows update indicators. Or manually: `git pull && npm install && npm run build`.

## Verifying Releases

```bash
curl -LO https://github.com/sorlen008/claude-command-center/releases/download/vX.Y.Z/claude-command-center-vX.Y.Z.tar.gz
curl -LO https://github.com/sorlen008/claude-command-center/releases/download/vX.Y.Z/checksums-vX.Y.Z.sha256
sha256sum -c checksums-vX.Y.Z.sha256
```

## Tech Stack

**Frontend:** React 18, TanStack Query, Tailwind CSS, Radix UI, React Flow
**Backend:** Express 5, chokidar, Zod
**Build:** Vite + esbuild, TypeScript throughout
**No external services** -- everything runs locally

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues via [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
