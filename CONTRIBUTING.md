# Contributing

Contributions are welcome. This guide covers the workflow and expectations.

## Getting started

1. Fork the repository and clone your fork.
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
   The dashboard runs at `http://localhost:5100`.

## Development commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server with hot reload |
| `npm run check` | TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Run tests (`vitest run`) |
| `npm run build` | Production build |

## Pull request requirements

- `npm run check` passes with no errors.
- `npm test` passes.
- No unnecessary new dependencies. If you add one, justify it in the PR description.
- Keep PRs focused. One feature or fix per PR.
- Write a clear description of what changed and why.

## Code style

- TypeScript throughout. No `any` unless truly unavoidable.
- Follow existing patterns in the codebase.
- Use Zod for runtime validation of external input.
- Spawn shell commands with array-style arguments (never string interpolation).
- No emojis in code or commit messages.

## Commit messages

Use conventional prefixes:

```
feat: add session filtering by project
fix: handle missing .claude directory gracefully
chore: update dependencies
```

## Good first issues

Look for issues labeled [`good first issue`](https://github.com/sorlen008/claude-command-center/labels/good%20first%20issue) — these are scoped, well-defined tasks ideal for first-time contributors. Examples of what makes a good contribution:

- Add a new stat card or chart to the Analytics page
- Improve an existing page's UX (better loading states, empty states)
- Add a new MCP server to the knowledge base catalog (`server/scanner/knowledge-base.ts`)
- Write tests for untested routes or parsers
- Fix a UI bug or accessibility issue

## Architecture overview

```
server/
  routes/          # Express API routes (/api/sessions, /api/entities, etc.)
  scanner/         # JSONL parsers, file watchers, analytics engines
  db.ts            # JSON database with atomic writes
  storage.ts       # Storage abstraction layer
shared/
  types.ts         # Shared TypeScript interfaces (server + client)
client/
  src/pages/       # React page components (one file per page)
  src/hooks/       # React Query hooks (data fetching)
  src/components/  # Reusable UI components (shadcn-based)
tests/             # Vitest tests
```

**Adding a new page:** Create a page in `client/src/pages/`, add a route in `App.tsx`, add a nav item in `layout.tsx`. Create a hook in `client/src/hooks/` if it needs data. Add an API route in `server/routes/` if needed.

**Adding a new scanner:** Add a file in `server/scanner/`, export it from the scanner index, and call it during the scan cycle.

## Reporting bugs

Open a [GitHub issue](https://github.com/sorlen008/claude-command-center/issues) with:

- Steps to reproduce
- Expected vs. actual behavior
- Node.js version and OS

## Security issues

Do **not** report security vulnerabilities via public issues. See [SECURITY.md](SECURITY.md).
