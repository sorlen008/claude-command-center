# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.27.0] - 2026-04-13

### Added
- **Help Center v2** — dedicated `/help` page with four tabs (First 5 Minutes, Browse, Glossary, Cheat Sheet), 107 topics across 15 categories, per-topic beginner/intermediate/advanced filter, 49-term glossary, URL-hash deep-linking (`/help#live:2`, `/help#glossary`, `/help#q=compact`)
- **Graph Focus Lens** — default view shows only the focus node + its neighborhood (up to 40 nodes) in a radial layout; dramatically reduces visual tangling on dense graphs (tested on 263-node / 1166-edge datasets)
- **Focus picker dropdown** — searchable Command palette listing every entity grouped by type, sorted by connection count, so power users can jump to any node from the full graph without leaving Focus mode
- **Live → Sessions deep link** — click any Live session card body to navigate to `/sessions?session=<uuid>` with the target session pre-expanded and scrolled into view
- **Compact button on Live cards** — visible purple pill left of the Context bar, opens an explanatory dialog and copies `/compact` to clipboard
- **Cross-links** — onboarding wizard final step and Live page Session Context Guide both link into Help Center

### Changed
- **Graph pan/zoom overhaul** — removed `fitView={true}` prop that fired on every re-render; replaced `onMoveStart`/`onMoveEnd` with `onMove` heartbeat that closes the wheel-zoom gap; hover dim now uses 1-hop neighbors only (full BFS kept for click → blast radius); swapped `getSmoothStepPath` → `getBezierPath` for cleaner edge bundling
- **Dynamic node handles** — nodes now orient handles based on layout direction (TB → Top/Bottom, LR → Left/Right), fixing edge routing chaos in LR mode
- **Graph route CSS scoping** — `graph-active` body class disables `backdrop-filter` blur and the gradient-drift root animation on the graph route only, freeing compositor cycles for pan/zoom

## [1.26.0] - 2026-04-13

### Changed
- **Tech debt cleanup** — consolidated model pricing to a single source of truth (`server/scanner/pricing.ts`), added DB schema versioning with `migrate()` function, split `sessions.ts` god router into analytics/prompts/workflows sub-routers, pruned 45+ comments that restated WHAT code did, added `TypedEntity` discriminated union (non-breaking additive type)
- **Security fixes** — Windows `session-delegation.ts` now sanitizes `cwd` before shell spawn; `MAX_BATCH_SUMMARIZE=10` hard cap on summarize-batch DoS; `IdsArraySchema` validates UUIDs via `SessionIdSchema`; `ai-suggest.ts` removes raw prompts from error responses and adds `--no-session-persistence`

## [1.25.0] - 2026-04-12

### Added
- **Skill category auto-inference** — skills are now grouped by inferred category (devops, quality, docs, ai, data, etc.) using a data-driven regex rule table in `server/scanner/skill-scanner.ts`; toggle grouping on/off with a toolbar button
- **Summarize dropdown** — Sessions page Summarize button is now a dropdown with three modes: All (next 10 unsummarized), Top 10 (most-used), Pinned (pinned only)

### Fixed
- Removed PII leaks: `nicora-desk` and project-specific MCPs pulled from knowledge base
- Expanded `new-user-safety.test.ts` to scan `server/` directory in addition to `client/src/`
- Added pre-commit hook that runs safety tests before every commit (blocks PII leaks to public repo)

## [1.24.0] - 2026-04-11

### Added
- **MCP recommendation engine** — analyzes project tech stack (package.json, Dockerfile, env files) and suggests matching MCPs from the catalog
- **Session HTML export** — download any session as a standalone, sanitized HTML report with the full message timeline; shareable via email or chat
- **Graph blast radius** — click a node to see the BFS-computed count of every downstream entity affected by a change ("if this MCP breaks, 5 projects are affected")

## [1.23.0] - 2026-04-10

### Added
- **Insights engine** (`server/scanner/insights.ts`) — automated suggestions derived from real usage: cost-optimizer recommendations (Opus → Sonnet savings), cost-spike detection (>2× rolling 7-day average), heavy-model usage warnings, week-over-week trend alerts, stale session suggestions, duplicate-work detection, budget alerts (80%/100% thresholds)
- **Monthly budget planner** — set a monthly spend cap in Settings; Dashboard Usage card shows progress bar; warning and critical insights fire at 80% and 100%
- **Cost-spike anomaly detection** — rolling average based detection with drill-down to contributing sessions

## [1.22.1] - 2026-04-10

### Added
- **Mobile-responsive sidebar** — auto-collapses below 768px, bottom-nav friendly
- **Graph virtualization** — `onlyRenderVisibleElements` enabled for node counts > 200
- **Session pagination** — server-side pagination with `page` + `limit` params, infinite-scroll UI on client
- **Accessibility pass** — aria-labels on interactive elements, navigation landmarks, focus management on dialogs

## [1.22.0] - 2026-04-10

### Added
- **Session duration on cards** — elapsed time from first to last timestamp
- **Token count estimates** — "~45K tokens" label based on JSONL file size
- **CSV export for cost analytics** — download daily costs as a CSV on the Stats page
- **Ctrl+B keyboard shortcut** — toggle sidebar (alongside existing Ctrl+L)
- **Markdown autosave** — 1.5s debounced autosave with "Saved" badge
- **15 new MCPs in catalog** — Twilio, Notion, Airtable, Perplexity, MongoDB, Redis, Docker, AWS, Datadog, Sentry, Jira, ClickUp, HubSpot, Shopify, Twitch

## [1.21.8] - 2026-04-09

### Fixed
- 9 dependency vulnerabilities (`npm audit fix`)

## [1.21.7] - 2026-04-09

### Added
- **Usage dashboard card** — today / week / 30-day spend with budget progress bar
- **Fuzzy session search** — default Deep mode with word-based matching
- **UUID search mode** — exact-match mode for pasting session IDs

## [1.21.6] - 2026-04-08

### Fixed
- Restored Pin button on Live view session cards (was hidden for sessions without JSONL history)

## [1.21.5] - 2026-04-08

### Added
- Gitignored `docs/screenshots/` (contains live user data)
- Pre-commit safety hook blocking PII leaks
- Removed previously-committed screenshot binaries from git history

## [1.21.4] - 2026-04-07

### Fixed
- **Security audit**: removed hardcoded user paths, phone numbers, and personal project names from UI strings, placeholder text, examples

## [1.21.3] - 2026-04-07

### Added
- **Full UUID display** on session cards (clickable to copy) — no more clicking into a session to find its ID
- **Pin sessions from Live view** — pin button on every Live session card
- **Delete-All preserves pinned sessions** — bulk delete now skips pinned entries

## [1.21.2] - 2026-04-06

### Fixed
- Live view detects orphaned session agents (agents whose parent Claude process exited)
- 6 uncategorized MCPs added to knowledge base (browsermcp, discord, telegram, fakechat, etc.)

## [1.21.1] - 2026-04-06

### Added
- **Context & Session Tips guide** — collapsible educational panel on Live view explaining context-window compression, session statuses, and model context limits (Haiku 200k, Sonnet 200k, Opus 1M)

## [1.21.0] - 2026-04-05

### Changed
- Removed standalone Rules page; configuration now lives in Settings
- Merged Activity and Discovery pages into a single route with tabs
- Fixed Live session stats showing duplicate data across sessions

## [1.20.0] - 2026-04-04

### Added
- **Agents page rewrite** — learn guide, description extraction fix, scanner dedup across plugin marketplaces, copyable file paths, recursive discovery under `~/.claude/plugins/`

## [1.19.1] - 2026-04-03

### Fixed
- Session terminal launch on Windows — use `shell: true` spawn instead of passing the command as a single argument

## [1.19.0] - 2026-04-03

### Added
- **Prompt templates page** (`/prompts`) — save, search, tag, favorite, and copy reusable prompt templates
- **Markdown mega-enhancement** — context summary bar, full-content search, file creation wizard, type grouping, per-file budget meter, pin/lock, diff view on restore, section templates

## [1.18.0] - 2026-04-02

### Added
- **Markdown page upgrades** — quick-edit drawer, drift analyzer (detects stale docs), dependency graph, live polling
- **Server refactors** — split markdown scanner into smaller focused modules

## [1.17.1] - 2026-04-02

### Fixed
- Session query invalidation — pin, delete, and summarize now update the UI immediately (was stale until manual refresh)

## [1.17.0] - 2026-04-01

### Added
- **CLI receipt and audit** — log of spawned `claude -p` invocations with stderr/stdout
- **Live cost ticker** — real-time total spend for currently-active sessions
- **Subscription billing awareness** — compare spend against Max $100/mo and $200/mo plan limits

### Fixed
- Pin button and terminal launch edge cases across platforms

## [1.16.1] - 2026-03-18

### Added
- **New-user safety test suite** — 1,018 automated checks scanning all source files for hardcoded paths, PII, and user-specific strings
- **CLAUDE.md** development guide with 8 safety rules for contributors

## [1.16.0] - 2026-03-18

### Added
- **Operations Nerve Center** — real-time service health monitoring, cost pacing, attention items, overnight activity
- **Continuation Intelligence** — detects unfinished sessions, uncommitted git changes, one-click resume/delegation
- **Bash Command Knowledge Base** — indexes every shell command across sessions with categories, success rates, failure hotspots, and search
- **Decision Log** — AI-extracts architectural decisions (topic, alternatives, trade-offs) from sessions via Haiku
- **Session Delegation** — continue sessions via terminal (cross-platform), Telegram bot, or voice call

### Fixed
- Removed all hardcoded user paths, phone numbers, and project-specific text from source code
- Nerve center services now configurable via `NERVE_CENTER_SERVICES` env var (defaults to Command Center only)
- Voice delegation uses `VOICE_CALLER_SCRIPT` + `VOICE_PHONE` env vars instead of hardcoded values
- Terminal delegation now cross-platform (Windows, macOS, Linux)
- All AI features (summarize, NL query, decisions) pre-check Claude CLI availability and return 503 with clear message
- Generalized MCP catalog descriptions and AI prompt examples

## [1.15.0] - 2026-03-18

### Added
- **Session Notes** — add/edit/delete personal annotations on any session
- **Pinned Sessions** — pin sessions to top of list, persisted across reloads
- **Cross-Session File Timeline** — click any file in heatmap to see every change across all sessions
- **Natural Language Query** — ask questions about analytics data ("Which project costs the most?")

## [1.14.0] - 2026-03-18

### Added
- **Project Dashboards** — per-project aggregated view with cost, health, files, topics
- **Session Diff Viewer** — inline diffs of Write/Edit operations in expanded session cards
- **Prompt Library** — save/reuse prompt templates with one-click copy
- **Weekly Digest** — automated weekly summary with accomplishments, project breakdown
- **Auto-Workflows** — configurable auto-summarize, stale flagging, cost alerts, auto-tag

## [1.13.0] - 2026-03-18

### Added
- **Deep Search** — full-text search across all session JSONL message content
- **AI Summaries** — Claude Haiku-generated one-paragraph summaries with topics, outcome, tools, files
- **Cost Analytics** — per-session, per-project, per-model, daily spend with charts
- **File Heatmap** — most-touched files with read/edit/write counts
- **Session Health** — tool error and retry pattern detection (good/fair/poor scoring)
- **Stale Session Detection** — identifies empty and old sessions with reclaimable storage
- **Smart Context Loader** — generates context prompts from recent session summaries
- **Session-to-Commit Linking** — matches git commits to sessions by timestamp

## [1.6.0] - 2026-03-16

### Added
- **APIs page** (`/apis`) for managing external API connections
- **API config scanner** — `apis-config.yaml` for declaring external services
- **Graph view modes** — 6 ways to view your ecosystem: Graph, Tiles, Tree, List, Radial, Matrix
- **Restart button** with confirmation dialog after updates — spawns new server process, auto-reloads browser

### Fixed
- Server dying after update with no restart (removed `process.exit`, added proper restart endpoint)
- Graph page view mode persistence

## [1.3.2] - 2026-03-16

### Fixed
- Onboarding wizard not persisting -- settings PATCH route was dropping the `onboarded` field from request body

## [1.3.1] - 2026-03-16

### Fixed
- Cost estimate formula was ~10x too low (treating all input tokens as cache reads)
- Unknown session status defaulting to "thinking" instead of "stale"
- Message parsing safety cap (2000 messages) to prevent OOM on large sessions

## [1.3.0] - 2026-03-16

### Added
- **Cost Analytics page** (`/costs`) -- daily cost chart (30 days), per-model and per-project breakdown, cache savings calculation, plan limit comparison ($100/$200 thresholds)
- **Error Breakdown** on cost page -- categorizes tool errors, compilation failures, test failures, permission denials, network errors with counts and examples
- **Message History page** (`/messages`) -- chronological timeline of all user instructions across sessions, expandable conversation view with tool name badges
- **Session status detection** -- thinking (green pulse), waiting (yellow), idle (grey), stale (dimmed) based on JSONL file mtime
- **Permission mode badges** -- BYPASS (red) and AUTO (yellow) badges on active sessions in Live view
- **Git branch display** -- shows current branch per session in Live view (reads .git/HEAD directly)
- **Plan comparison** -- visual bar comparing monthly spend against Max $100/mo and $200/mo plan limits
- **Session messages API** (`GET /api/sessions/:id/messages`) -- paginated conversation with role, content, model, token count, tool names

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
