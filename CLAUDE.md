# Command Center — Development Guide

## Quick Start

```bash
npm install
npm run dev        # starts on http://localhost:5100
npm run check      # TypeScript type-check
npm test           # run all tests (2000+ tests)
```

## Architecture

Express.js backend + React frontend (TypeScript), served from a single process. Session data is read from `~/.claude/projects/` JSONL files. Persistent state stored in `~/.claude-command-center/command-center.json`.

## New-User Safety Rules

**CRITICAL — Follow these rules for ALL changes:**

1. **No hardcoded paths.** Never use absolute paths like `C:/Users/zwin0/...` or `/Users/hi/...`. Use `os.homedir()`, env vars, or relative paths.

2. **No PII in source code.** Never hardcode phone numbers, email addresses, IP addresses, or personal names. Use env vars for user-specific config.

3. **No user-specific project names in UI.** Never reference specific projects (Nicora Desk, findash, etc.) in placeholder text, examples, or labels. Use generic examples like "my-app", "backend".

4. **Claude CLI features must pre-check availability.** Any route that spawns `claude -p` must call `isClaudeAvailable()` first and return 503 with a clear message if not installed. Users may not have Claude Code CLI.

5. **External services must be configurable.** Don't hardcode service ports or URLs. Use env vars (e.g., `NERVE_CENTER_SERVICES`). Default to minimal config that works without external services.

6. **Cross-platform support.** Terminal/process spawning must handle win32, darwin, and linux. Never assume Windows `cmd.exe`.

7. **Graceful degradation.** Every scanner and API endpoint must return a valid response even when data is empty, files are missing, or services are down. Use try/catch, return empty arrays, never crash.

8. **Run `new-user-safety.test.ts` after changes.** This test automatically catches hardcoded paths, phone numbers, PII, and user-specific UI strings. If it fails, fix before committing.

9. **No screenshots in git.** `docs/screenshots/` is gitignored. Screenshots contain live user data and must never be committed. Also watch for encoded path forms like `C--Users-username` (Claude project key format).

## Key Commands

```bash
npm run dev          # dev server with hot reload
npm run check        # TypeScript type-check (must pass before commit)
npm test             # all tests including new-user-safety checks
npm run build        # production build
```

## Commit Format

```
feat: description — vX.Y.Z
fix: description — vX.Y.Z
chore: description — vX.Y.Z
```

## File Structure

```
server/
  routes/          # Express API routes
  scanner/         # JSONL parsers, analytics, AI features
    plan-usage.ts        # Plan-awareness + personal-ceiling orchestration
    historical-limits.ts # Parses rate_limit events from JSONL; personal percentiles
    turn-extractor.ts    # Shared JSONL → turn/error/rateLimitEvent parser
  db.ts            # JSON database with atomic writes
  storage.ts       # Storage abstraction layer
shared/
  types.ts         # Shared TypeScript interfaces
client/
  src/pages/       # React page components
    stats.tsx      # Analytics/Billing tab — personal-ceiling UI, percentile bar, API mode
    help.tsx       # Help Center — 5 tabs (First 5 Min / Browse / Claude Code / Glossary / Cheat Sheet)
  src/hooks/       # React Query hooks
  src/components/
    plan-status-indicator.tsx # Sidebar pill; dual-mode (subscription vs API)
tests/             # Vitest tests
```

## Billing / Plan-Awareness Architecture

The Analytics/Billing tab derives a *personal* session-window ceiling from the user's own past rate-limit events — not Anthropic's wide published ranges.

1. `turn-extractor.ts` scans JSONL files and separates normal turns from synthetic `rate_limit` assistant messages (`type:"assistant"`, `error:"rate_limit"`, `isApiErrorMessage:true`).
2. `historical-limits.ts::buildHistoricalLimits()` walks every session + subagent file, reconstructs the 5-hour window preceding each hit, and reports median / P25 / P50 / P90 tokens and hours.
3. `plan-usage.ts::buildPlanUsage()` combines that with plan catalog data and returns a `PlanUsageResponse` containing:
   - `historicalLimits` — percentiles and hit history
   - `estimatedCeiling` — plan-based fallback when `sampleSize === 0`
   - `planDetectionHint` — non-blocking upgrade suggestion when observed median mismatches selected plan (≥5 hits only, never downgrades)
   - `noSessionsYet` — short-circuits the UI for brand-new installs
4. `stats.tsx` renders: zero-session empty state → onboarding card (no plan) → API cost card (pay-as-you-go) OR session-countdown card (subscription) → plan hint → plan selector → usage bars.
5. `plan-status-indicator.tsx` (sidebar pill) mirrors the same three-tier logic: personal percentage, fallback `est.` percentage, or plain reset countdown. API mode shows monthly $ spent instead.

When adding fields to `PlanUsageResponse`: always restart the server after the change — Vite HMR will load new client code against stale server responses and crash with `undefined.fieldName`.

## Help Center Structure

`client/src/pages/help.tsx` is a single-file Help Center with five tabs:

1. **First 5 Minutes** — linear walkthrough with CTA buttons
2. **Browse** — 15 categories × ~107 topics with difficulty filter (beginner / all / advanced)
3. **Claude Code** — 8 categories × ~63 CLI commands, shortcuts, modes, features (reference for `/compact`, `/plan`, `--model`, etc.)
4. **Glossary** — 50 terms
5. **Cheat Sheet** — shortcuts, URL params, env vars

Content lives in three typed constants: `CATEGORIES` (Browse), `CLI_CATEGORIES` (Claude Code), `GLOSSARY`. Keyboard shortcuts are imported from `keyboard-shortcuts.tsx::SHORTCUT_SECTIONS` so the Cheat Sheet and the `?` overlay never drift. Topic DOM keys are slug-based (not array indices) so deep-links survive the difficulty filter. URL hash routing: `/help#<tab>`, `/help#<category>:<topic>`, `/help#q=<query>`.

When adding a new keyboard shortcut: add it to `SHORTCUT_SECTIONS` in `keyboard-shortcuts.tsx` — it appears in both the overlay and the Cheat Sheet automatically.

## Adding AI Features (claude -p)

When adding features that use `claude -p`:

1. Add `--no-session-persistence` flag to prevent polluting user's session list
2. Remove `CLAUDECODE` from env: `delete env.CLAUDECODE`
3. Add `isClaudeAvailable()` check in the route handler
4. Handle errors gracefully — return 500 with descriptive message
5. Set reasonable timeouts (60s for queries, 300s for summarization)

## Adding New Services/Integrations

When adding integrations with external services:

1. Use env vars for all URLs, ports, paths, API keys
2. Document the env var in this file and in README.md
3. Default behavior when env var is not set: feature is disabled, returns helpful message
4. Never expose the feature as "broken" — show "not configured" state instead

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | 5100 |
| `HOST` | Server host | 127.0.0.1 |
| `COMMAND_CENTER_DATA` | Data directory | ~/.claude-command-center |
| `NERVE_CENTER_SERVICES` | Services to monitor (name:port,name:port) | Command Center:5100 |
| `VOICE_CALLER_SCRIPT` | Path to voice outbound caller script | (disabled) |
| `VOICE_PHONE` | Phone number for voice calls | (disabled) |

## Tests

- **2000+ unit tests** covering parsers, routes, storage, validation, client pages
- **`new-user-safety.test.ts`** — automated guardrail that scans all source files for:
  - Hardcoded user paths (both decoded `C:/Users/...` and encoded `C--Users-...`)
  - Phone numbers / PII
  - User-specific project names in UI
  - Missing Claude CLI pre-checks
  - Missing cross-platform support
  - Missing env var configuration for external services

## Pre-commit Hook (PII Guard)

A git pre-commit hook runs `new-user-safety.test.ts` before every commit. If PII is detected, the commit is blocked. This repo is **public** — any leaked data is immediately visible.

The hook lives at `.git/hooks/pre-commit` (not tracked in git). If it's missing after a fresh clone, recreate it:

```bash
cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/bash
echo "Running safety checks..."
cd "$(git rev-parse --show-toplevel)"
npx vitest run tests/new-user-safety.test.ts --reporter=dot 2>&1
if [ $? -ne 0 ]; then
  echo "BLOCKED: Safety test failed — personal data or hardcoded paths detected."
  exit 1
fi
HOOK
chmod +x .git/hooks/pre-commit
```
