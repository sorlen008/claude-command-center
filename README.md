# Claude Command Center

A local dashboard for visualizing and managing your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ecosystem. Auto-discovers your projects, MCP servers, skills, plugins, sessions, agents, and their relationships with zero configuration.

Built for Claude Code power users who want a bird's-eye view of everything in their `~/.claude/` setup.

## What It Does

- **Auto-discovers** all Claude Code projects, MCP servers, skills, plugins, and markdown files across your home directory
- **Session browser** — search, filter, sort, and manage all your Claude Code sessions with bulk operations
- **Agent tracker** — see agent definitions and execution history across sessions
- **Live view** — real-time monitoring of active Claude Code sessions and running agents
- **Graph visualization** — interactive force-directed graph of your entire Claude Code ecosystem and entity relationships
- **Markdown editor** — edit `CLAUDE.md` and memory files directly in the browser with version history
- **Discovery** — finds potential projects and MCP servers you haven't configured yet
- **Config viewer** — inspect your Claude Code settings, MCP configs, and permissions
- **Activity feed** — timeline of recent file changes across your Claude Code setup
- **One-click updates** — check for and apply updates directly from the sidebar

## Quick Start

```bash
git clone https://github.com/sorlen008/claude-command-center.git
cd claude-command-center
npm install
npm run dev
```

Open [http://localhost:5100](http://localhost:5100) in your browser.

That's it. The scanner will automatically find everything in your `~/.claude/` directory and home folder.

## Requirements

- **Node.js 18+** (tested on 20, 22, 24)
- **Claude Code** installed — the dashboard reads from `~/.claude/` which Claude Code creates
- **git** — required for the update feature (optional otherwise)

## Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Overview with entity counts, health indicators, and quick stats |
| **Projects** | All discovered projects with session counts, tech stack, and health status |
| **MCP Servers** | Every MCP server found in `.mcp.json` files across your system |
| **Skills** | User-invocable and system skills with content preview |
| **Plugins** | Installed and available plugins, marketplace links |
| **Markdown** | All `CLAUDE.md`, memory files, and READMEs with inline editing |
| **Sessions** | Full session history — search by message content, sort by date/size, bulk delete |
| **Agents** | Agent definitions and execution logs grouped by type and model |
| **Live** | Real-time view of running Claude Code processes and active agents |
| **Graph** | Interactive node graph showing relationships between all entities |
| **Discovery** | Suggests unconfigured projects and MCP servers it found on disk |
| **Config** | Your Claude Code settings, permissions, and MCP configurations |
| **Activity** | Recent file-change timeline from the file watcher |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5100` | Server port |
| `COMMAND_CENTER_DATA` | `~/.claude-command-center/` | Data directory for the local database |

Set them as environment variables before starting:

```bash
PORT=3000 npm run dev
```

## Updating

The sidebar shows an update indicator when new commits are available on the remote. Click it to check for updates and apply them (runs `git pull` + `npm install` + `npm run build`). Restart the server after updating.

Or manually:

```bash
git pull
npm install
npm run build
npm start
```

## Building for Production

```bash
npm run build    # Bundles client (Vite) + server (esbuild)
npm start        # Runs the production bundle
```

The production build outputs to `dist/` — a single `index.cjs` for the server and static assets in `dist/public/`.

## Tech Stack

- **Frontend:** React 18, TanStack Query, Tailwind CSS, Radix UI, Wouter, React Flow
- **Backend:** Express 5, better-sqlite3, chokidar (file watcher)
- **Build:** Vite (client), esbuild (server), TypeScript throughout
- **No external services** — everything runs locally, reads only from your filesystem

## How It Works

On startup, the server scans your home directory for Claude Code artifacts:

1. **Projects** — directories with `CLAUDE.md`, `.mcp.json`, or `package.json` + `.git`
2. **MCP servers** — parsed from every `.mcp.json` found
3. **Skills** — from `~/.claude/skills/` and project-level skill directories
4. **Plugins** — from `~/.claude/plugins/`
5. **Sessions** — from `~/.claude/projects/*/sessions/`
6. **Agents** — agent definitions from plugins + execution logs from sessions
7. **Relationships** — cross-references between all of the above

A file watcher (chokidar) keeps the data fresh — changes to any scanned file trigger incremental re-scans pushed via Server-Sent Events.

## Cross-Platform

Works on **Windows**, **macOS**, and **Linux**. Platform-specific actions (open folder, resume session) adapt automatically.

## License

MIT
