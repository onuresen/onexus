# ONEXUS — Developer Guide for AI-Assisted Development

This file documents project conventions for Claude Code and other AI coding tools.

## Project nature

- **No build step.** ONEXUS is plain HTML + vanilla JavaScript served statically. Never add a bundler, transpiler, or module system.
- **Browser globals by design.** Key objects (`window.cy`, `window.ONEXUS`, `window.__onexus_state`, etc.) are intentionally global — this is not a bug.
- **Plugin architecture.** New importers and features go into `src/plugins/`. Register them in `src/plugins/manifest.json`.

## Directory layout

```
src/core/       Graph engine, state, undo, filters, IO
src/plugins/    Importers (IFC, COBie, CSV, GD) + plugins
src/ui/         DOM bindings, loader, widgets, tour
src/helpers/    Utilities: logger, styling, compat shims
src/dev/        Dev-only tools (audit, selftest, diagnostics) — not shipped in prod
src/common/     Shared CSS and boot check
src/layouts/    Layout CSS
samples/        Example JSON datasets for manual testing
tests/          Playwright end-to-end tests
onexus-backend/ Optional Express.js graph storage server
```

## Running the project

```bash
# Serve locally (no install required)
npx http-server -p 4173 .
# Open http://localhost:4173
```

## Running tests

```bash
npm install
npx playwright install --with-deps chromium
npm run serve &         # start http-server in background
npm run test:smoke      # run all Playwright tests
```

## Linting and formatting

```bash
npm run lint            # ESLint — check src/
npm run lint:fix        # ESLint — auto-fix where possible
npm run format          # Prettier — format src/
npm run format:check    # Prettier — check without writing
```

## Key public APIs

| Symbol | File | Purpose |
|--------|------|---------|
| `window.onexusLoadGraph(data)` | `src/core/graph-core.io.host.js` | Load a graph object into the viewer |
| `window.cy` | `src/core/graph-core.state.js` | Cytoscape.js instance |
| `window.ONEXUS` | `src/helpers/onexus-ns.js` | Main namespace object |
| `window.ONEXUS_UNDO` | `src/core/graph-core.undo.js` | `{ undo, redo, canUndo, canRedo }` |
| `window.setLayerMode(mode)` | `src/core/graph-core.state.js` | Switch layer (relationship/lifecycle/foundation) |
| `window.getLayerMode()` | `src/core/graph-core.state.js` | Get current layer mode string |
| `window.filterByCategory(cat)` | `src/core/graph-core.filters.js` | Apply category filter |
| `window.ONEXUS_LOG` | `src/helpers/onexus-logger.js` | Debug logger — gated by `ONEXUS_DEBUG` flag |

## Debug logging

Set `window.ONEXUS_DEBUG = true` **before** loading the page (or append `?debug=1` to the URL) to enable verbose `ONEXUS_LOG.log()` and `ONEXUS_LOG.table()` output. `warn` and `error` are always active.

## Backend (optional)

`onexus-backend/` is a standalone Express.js service for persistent graph storage. Start it separately:

```bash
cd onexus-backend
npm install
node server.js
# Listens on $PORT or 8787 by default
```

> The backend has **no authentication** by design (local/trusted-network use). Do not expose it publicly without a reverse proxy and auth layer.

## Coding conventions

- Keep vanilla JS — no TypeScript, no React, no build step.
- Prefer small, well-scoped functions; avoid large new files.
- New debug output must use `window.ONEXUS_LOG.log(...)` (gated), not `console.log`.
- `console.warn` and `console.error` are fine for real user-visible signals.
- Add Playwright tests in `tests/` for any new feature that affects the public API surface.
