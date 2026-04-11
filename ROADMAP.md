# Claude Command Center — Product Roadmap

**Current:** v1.21.8 | 24K lines | 23 pages | 1351 tests | 21 cloners/2wks | 2 stars
**Goal:** Grow from personal dashboard to community-adopted Claude Code companion tool

---

## Quick Wins (Ship This Week)

| # | Item | Effort | Files |
|---|------|--------|-------|
| 1 | **Session duration on cards** — show elapsed time (firstTs→lastTs) | S | `client/src/pages/sessions.tsx` |
| 2 | **Token count on session cards** — "45K tokens" at a glance | S | `client/src/pages/sessions.tsx`, `server/routes/sessions.ts` |
| 3 | **CSV export for cost analytics** — download daily costs as CSV | S | `client/src/pages/stats.tsx` |
| 4 | **Theme persistence** — save to localStorage, survive reload | S | `client/src/hooks/use-theme.ts` |
| 5 | **Sidebar keyboard shortcut** — Ctrl+B to toggle | S | `client/src/components/layout.tsx` |
| 6 | **Add 10 missing MCPs to catalog** — Twilio, Notion, Sentry, Datadog, etc. | S | `server/scanner/knowledge-base.ts` |
| 7 | **Autosave indicator for markdown editor** — dirty state + auto-save | S | `client/src/pages/markdown-edit.tsx` |

These are the 5 open GitHub issues (#8-#12) plus 2 extras. Each is a single-file change.

---

## Phase 1: Polish & Performance (v1.22 — v1.23)
**Theme:** "Make what exists great"
**Timeline:** 2 weeks
**Why:** First impressions matter. New users bounce on slow pages and broken mobile views.

| # | Deliverable | Effort | Impact | Area |
|---|-------------|--------|--------|------|
| 1 | **Mobile-responsive layout** — sidebar collapses to bottom nav, cards stack, graph gets touch controls | M | High | `client/src/components/layout.tsx`, all pages |
| 2 | **Graph performance** — virtualize nodes >200, lazy-load edges, debounce layout | M | High | `client/src/pages/graph.tsx`, `server/routes/graph.ts` |
| 3 | **Session pagination** — server-side pagination with page/limit, infinite scroll on frontend | M | Medium | `server/routes/sessions.ts`, `client/src/pages/sessions.tsx` |
| 4 | **Accessibility pass** — aria labels on all interactive elements, keyboard navigation for graph, focus management | M | Medium | All components |
| 5 | **Onboarding improvements** — first-run tutorial, feature highlights, "what's new" modal on updates | S | High | `client/src/components/onboarding-wizard.tsx` |

**Exit criteria:** Lighthouse mobile score >80, graph renders 500 nodes in <2s, all pages keyboard-navigable.

---

## Phase 2: Intelligence & Insights (v1.24 — v1.25)
**Theme:** "Your data works for you"
**Timeline:** 3 weeks
**Why:** This is the killer feature gap. Users have rich session data but no actionable insights.

| # | Deliverable | Effort | Impact | Area |
|---|-------------|--------|--------|------|
| 1 | **Cost optimization suggestions** — "Switch to Haiku for summaries, save 80%" per-session model recommendations | M | High | New: `server/scanner/cost-optimizer.ts`, `client/src/pages/stats.tsx` |
| 2 | **Anomaly detection** — alert when daily cost spikes >2x average, tool error rate increases, sessions stuck | M | High | New: `server/scanner/anomaly-detector.ts`, dashboard card |
| 3 | **Pattern library** — auto-extract reusable patterns from successful sessions ("AWS VPC fix", "Docker debug") | L | High | New: `server/scanner/pattern-extractor.ts`, new page |
| 4 | **Budget planner** — set monthly budget, track burn rate, forecast end-of-month spend | S | Medium | `server/routes/cost-analytics.ts`, dashboard Usage card |
| 5 | **Duplicate work detector** — flag sessions that edit the same files with similar prompts | M | Medium | New: `server/scanner/duplicate-detector.ts` |

**Exit criteria:** Dashboard shows at least 1 actionable suggestion, budget alerts fire when >80% spent.

---

## Phase 3: Community & Discovery (v1.26 — v1.27)
**Theme:** "Discover, share, grow"
**Timeline:** 3 weeks
**Why:** This is what turns solo users into a community. Discovery reduces onboarding friction, sharing multiplies value.

| # | Deliverable | Effort | Impact | Area |
|---|-------------|--------|--------|------|
| 1 | **MCP recommendation engine** — "Based on your stack (Next.js, PostgreSQL), try: Vercel, Supabase MCPs" | M | High | `server/scanner/mcp-scanner.ts`, `client/src/pages/mcps.tsx` |
| 2 | **Session export/share** — export session as standalone HTML report (sanitized, no PII) | M | High | New: `server/routes/session-export.ts` |
| 3 | **Skill browser with community ratings** — browse GitHub-hosted skills, see stars/downloads, one-click install | L | High | New page: `client/src/pages/skill-marketplace.tsx` |
| 4 | **Guided MCP setup** — step-by-step install wizard for top 10 MCPs with env var prompts | M | Medium | New: `client/src/components/mcp-setup-wizard.tsx` |
| 5 | **Graph blast radius** — "If this MCP breaks, these 5 projects are affected" visualization | S | Medium | `client/src/components/graph/` |

**Exit criteria:** New users can discover and install 3 MCPs in <5 minutes, sessions exportable as shareable HTML.

---

## Phase 4: Team & Scale (v2.0)
**Theme:** "From solo to team"
**Timeline:** 4 weeks
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

## Feature Priority Matrix

```
                    HIGH IMPACT
                        |
   Phase 2:             |  Phase 3:
   Intelligence         |  Community
   (cost optimizer,     |  (MCP recs,
    anomaly detect,     |   session export,
    patterns)           |   skill marketplace)
                        |
  LOW EFFORT -----------+----------- HIGH EFFORT
                        |
   Phase 1:             |  Phase 4:
   Polish               |  Team & Scale
   (mobile, perf,       |  (multi-user,
    a11y, pagination)   |   activity feed,
                        |   plugin authoring)
                        |
                    LOW IMPACT
```

---

## Version Targets

| Version | Phase | Key Feature | Target |
|---------|-------|-------------|--------|
| v1.22 | Phase 1 | Mobile responsive + graph perf | Week 1-2 |
| v1.23 | Phase 1 | Pagination + accessibility | Week 2-3 |
| v1.24 | Phase 2 | Cost optimizer + anomaly detection | Week 4-5 |
| v1.25 | Phase 2 | Pattern library + budget planner | Week 5-6 |
| v1.26 | Phase 3 | MCP recommendations + session export | Week 7-8 |
| v1.27 | Phase 3 | Skill marketplace + setup wizards | Week 9-10 |
| v2.0 | Phase 4 | Multi-user + team features | Week 11-14 |

---

## Success Metrics

| Metric | Current | Phase 1 Target | Phase 4 Target |
|--------|---------|----------------|----------------|
| GitHub stars | 2 | 25 | 200 |
| Unique cloners/week | 10 | 30 | 100 |
| Open issues (community) | 5 | 15 | 50 |
| Contributors | 1 | 3 | 10 |
| Test count | 1351 | 1500 | 2000 |

---

## Implementation Notes

- **Each phase is independently shippable** — no phase depends on a future phase
- **Quick Wins ship first** — they're already GitHub issues, attract first contributors
- **PII safety maintained** — all new features must pass pre-commit hook (1219 safety checks)
- **No cloud dependencies** — everything runs locally, team features use git-synced metadata
- **Backward compatible** — existing users' data and configs must keep working
