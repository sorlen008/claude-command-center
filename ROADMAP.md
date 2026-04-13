# Claude Command Center — Product Roadmap

**Current:** v1.27.0 | 28K lines | 24 pages | 1818 tests | 17 routes
**Goal:** Grow from personal dashboard to community-adopted Claude Code companion tool

---

## Shipped (v1.22 — v1.27)

Roadmap Phases 1, 2, and most of 3 are complete. Highlights below with the version they landed in.

### v1.27.0 — Help Center v2 + Graph Focus Lens
- **Help Center v2** — dedicated `/help` page with four tabs (First 5 Minutes, Browse, Glossary, Cheat Sheet), 107 topics, 49-term glossary, URL-hash deep-linking, per-topic beginner/advanced filter
- **Graph Focus Lens** — default view shows focus node + 40-node radial neighborhood; searchable picker for any entity in the full graph; survival mode for graphs with 1000+ edges
- **Live → Sessions deep link** — click any Live card to open that session pre-expanded in Sessions
- **Graph pan/zoom overhaul** — `onMove` heartbeat closes the wheel-zoom gap; 1-hop hover replaces full BFS; bezier edges; dynamic handles for TB/LR layouts
- **Compact button on Live cards** — explanatory dialog, copies `/compact` to clipboard

### v1.26.0 — Tech debt cleanup
- Consolidated model pricing to a single source of truth
- DB schema versioning with `migrate()` function
- Split `sessions.ts` god router into analytics/prompts/workflows sub-routers
- `TypedEntity` discriminated union (non-breaking additive type)
- Security fixes: Windows command injection, DoS cap on summarize-batch, UUID validation

### v1.25.0 — Skill categories + summarize modes
- Skill auto-categorization via keyword rule table
- Summarize dropdown: All / Top 10 / Pinned
- PII purge from knowledge base; pre-commit safety hook

### v1.24.0 — Phase 3 core
- **MCP recommendation engine** — tech-stack aware suggestions
- **Session HTML export** — standalone sanitized report
- **Graph blast radius** — BFS-computed impact counts

### v1.23.0 — Phase 2 (Intelligence)
- **Insights engine** — cost-optimizer, anomaly detection, stale sessions, duplicate-work, budget alerts
- **Monthly budget planner** — 80%/100% thresholds on Dashboard Usage card
- **Cost-spike detection** — rolling 7-day average comparison

### v1.22.0 — v1.22.1 — Phase 1 (Polish)
- Mobile-responsive sidebar, graph virtualization, session pagination, accessibility pass
- Quick wins: session duration, token estimates, CSV export, Ctrl+B, autosave, 15 new MCPs

### v1.17.0 — v1.21.8 — Incremental features
- Prompt templates page, Agents page rewrite, Markdown mega-enhancement
- Full UUID display, pin from Live, delete-all preserves pinned
- Live view Context & Session Tips guide, orphan agent detection
- Usage dashboard card, fuzzy search, UUID search mode
- Multiple security audits and PII removals

---

## In Flight / Not Yet Shipped From Phase 3

These items from the original Phase 3 plan are still open:

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | **Skill marketplace browser** | L | Browse GitHub-hosted skills, one-click install, ratings |
| 2 | **Guided MCP setup wizard** | M | Step-by-step install wizard for top MCPs with env-var prompts |

---

## Phase 4: Team & Scale (v2.0)

**Theme:** "From solo to team"
**Timeline:** ~4 weeks of focused work
**Why:** This is the growth multiplier. Teams adopt tools that give them visibility across people.

| # | Deliverable | Effort | Impact | Area |
|---|-------------|--------|--------|------|
| 1 | **Multi-user support** — each user's Command Center can aggregate data from shared git repos | L | High | New: `server/scanner/team-scanner.ts` |
| 2 | **Team activity feed** — see what teammates worked on, which sessions ran, what decisions were made | L | High | New page: `client/src/pages/team.tsx` |
| 3 | **Decision log with annotations** — auto-extracted decisions with team comments and "reusable" tags | M | High | Enhance: `server/scanner/decision-extractor.ts` |
| 4 | **Plugin/skill authoring toolkit** — scaffold, test, publish workflow for custom skills | L | Medium | New: `server/routes/skill-authoring.ts`, wizard UI |
| 5 | **API & webhook system** — REST API for external integrations, webhooks for alerts | M | Medium | New: `server/routes/webhooks.ts` |

**Exit criteria:** 2+ users can view shared project data, decisions annotated and searchable across team.

---

## Candidate Ideas for Future Releases

Not committed to a phase yet. Pulled from user feedback, audit notes, and internal backlog.

- **Entity graph diffing** — "what changed in my graph since last week"
- **Session replay** — step through a past session like a debugger
- **Query DSL for sessions** — structured filters (cost > $5 AND model = opus AND project = my-app)
- **Export/import for personal settings and summaries** — portable `command-center.json`
- **Better mobile graph interaction** — touch-optimized pan/zoom, pinch
- **`.env.local` config** — make env vars editable from the Settings page
- **Plugin marketplace integration** — full plugin.json registry browsing
- **Offline-first PWA mode** — service worker, installable dashboard

---

## Version History (Completed)

| Version | Phase | Key Features |
|---------|-------|--------------|
| v1.27.0 | — | Help Center v2, Graph Focus Lens, Live→Sessions deep link |
| v1.26.0 | — | Tech debt cleanup, security fixes |
| v1.25.0 | — | Skill categories, summarize modes, pre-commit hook |
| v1.24.0 | Phase 3 (core) | MCP recommendations, session export, blast radius |
| v1.23.0 | Phase 2 | Insights engine, cost optimizer, budget planner |
| v1.22.1 | Phase 1 | Mobile responsive, graph perf, pagination, accessibility |
| v1.22.0 | Phase 1 | Quick wins — duration, tokens, CSV, Ctrl+B, autosave, 15 MCPs |
| v1.21.x | — | Usage card, fuzzy search, pin from Live, delete-all preserves pinned |
| v1.20.0 | — | Agents page rewrite |
| v1.19.0 | — | Prompt templates, markdown mega-enhancement |
| v1.17.0 | — | CLI receipt, live cost ticker, subscription billing |

See [CHANGELOG.md](CHANGELOG.md) for the full per-version breakdown.

---

## Implementation Notes

- **Each phase is independently shippable** — no phase depends on a future phase
- **PII safety is non-negotiable** — every change must pass `tests/new-user-safety.test.ts` (1685+ assertions), enforced by pre-commit hook
- **No cloud dependencies** — everything runs locally; team features (Phase 4) will use git-synced metadata
- **Backward compatible** — existing users' data and configs must keep working across upgrades
- **Release cadence** — minor versions for features, patch versions for docs/fixes
