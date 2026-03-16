# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-03-16

### Added
- **Smart update system** -- detects git clone vs npm install, uses appropriate update strategy
- Auto-restart server after successful update
- Auto-reload browser when server comes back online
- npm global users get `npm update -g` instead of git pull

## [1.2.0] - 2026-03-16

### Added
- **Onboarding wizard** -- 3-step first-launch setup (welcome, scan results, tips)
- **Theme system** -- 4 themes: Dark, Light, Glass, System (follows OS). Switcher in sidebar.
- **Stats page** (`/stats`) -- sessions-per-day chart, top projects, agent/model distribution
- **Export/Import** (`GET /api/export`, `POST /api/import`) for backup and restore
- **Keyboard shortcuts** -- press `G` then `D`/`S`/`A`/`G`/`L`/`M`/`P`/`K` to navigate
- **Dashboard enhancements** -- active session count, keyboard hints, 6 quick actions
- npm global install with shebang (`npm install -g claude-command-center`)

### Fixed
- Onboarding "Get Started" button not closing dialog (staleTime: Infinity cache issue)

## [1.1.0] - 2026-03-16

### Added
- **Stats page** (`/stats`) with sessions-per-day chart, top projects, agent/model distribution
- **Export/Import** (`GET /api/export`, `POST /api/import`) for backup and restore
- **Keyboard shortcuts** -- press `G` then `D`/`S`/`A`/`G`/`L`/`M`/`P`/`K` to navigate pages
- **Graph configuration** -- custom nodes, edges, and entity overrides via `graph-config.yaml`
- **AI-assisted graph suggestions** via `claude -p` with setup guide for new users
- **Docker Compose auto-discovery** -- extract services and `depends_on` as graph nodes/edges
- **Database URL extraction** from MCP environment variables (PostgreSQL, MySQL, MongoDB, Redis)
- **Custom node types** -- service, database, api, cicd, deploy, queue, cache
- **CRUD API** for custom graph nodes and edges
- **Live view enhancements** -- context usage bar, last message, message count, file size, cost estimate per session
- **Live view agents** -- running and recent agents with task descriptions per session
- **Dashboard enhancements** -- active session count, keyboard hints, 6 quick actions (Graph, Live, CLAUDE.md, Stats, Export, Discovery)
- Agent deduplication across plugin marketplaces
- Fallback YAML parser for agent definitions with malformed frontmatter
- Hover tooltips on agent stats cards
- Skill names in markdown files (parent directory name instead of "SKILL.md")
- CI workflow, CodeQL scanning, dependency review, OpenSSF Scorecard
- Release workflow with SHA-256 checksums (all GitHub Actions SHA-pinned)
- Security policy, contributing guide, code of conduct, threat model
- SETUP.md detailed installation guide with troubleshooting
- BRANDING.md for fork rebranding reference
- npm global install support (`npm install -g claude-command-center`)
- README with centered header, badges, screenshot grid, security section

### Fixed
- Agent descriptions missing for agents with colons in YAML frontmatter
- Sidebar agent count showing executions instead of definitions
- AI suggest timeout (increased to 5 minutes, uses Haiku model for speed)
- AI suggest command line too long on Windows (now uses stdin pipe)
- Duplicate agents from overlapping plugin marketplaces
- Cross-platform test for path validation (Linux CI)

## [1.0.0] - 2026-03-16

### Added
- Initial release
- Auto-discovery of projects, MCP servers, skills, plugins, sessions, agents
- 9 relationship types inferred between entities
- Interactive graph visualization with React Flow and dagre layout
- Session browser with search, filter, sort, and bulk delete
- Agent definitions viewer and execution history
- Live monitoring of active Claude Code sessions
- Markdown editor with version history and backups
- Discovery page for unconfigured projects and MCP servers
- Config viewer for Claude Code settings and permissions
- Activity feed from file watcher
- One-click updates from GitHub remote
- Cross-platform support (Windows, macOS, Linux)
- Server-Sent Events for real-time UI updates
- Zod validation on all API inputs
- Path traversal protection on file operations
- Secret redaction in scanned configuration files
