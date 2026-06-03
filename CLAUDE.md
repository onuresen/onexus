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

**Test philosophy: few, high-signal, no soft-skips.** The suite is intentionally
small:
- `onexus-smoke.spec.js` — the boot canary: app boots, plugins autoload, runtime
  audit + selftest pass, **zero console errors**.
- `onexus-features.spec.js` — load fidelity + export completeness (the export
  must contain the full graph even when a filter hides nodes).

Don't add tests that pass when the feature is absent (`if (!api) return`) — a
test that can't fail is worse than none. CI (`.github/workflows/onexus-smoke.yml`)
runs lint then these specs on every push/PR.

## Linting and formatting

```bash
npm run lint            # ESLint — check src/
npm run lint:fix        # ESLint — auto-fix where possible
npm run format          # Prettier — format src/
npm run format:check    # Prettier — check without writing
```

- **ESLint uses flat config** (`eslint.config.js`, ESLint 9+). The legacy
  `.eslintrc.json` was removed — it was unreadable by ESLint 9 and silently
  broke `npm run lint` (and CI). Globals come from the `globals` package plus
  the app globals (`cy`, `ONEXUS`, `cytoscape`). `ecmaVersion` is 2022.
- `package-lock.json` is committed — keep installs reproducible; run
  `npm install` (not a manual edit) to change deps.
- Lint must exit 0 in CI. Most rules are warnings; only `js.configs.recommended`
  errors fail the build. Prefer fixing over downgrading rules.

## Key public APIs

| Symbol | File | Purpose |
|--------|------|---------|
| `window.onexusLoadGraph(data)` | `src/core/graph-core.io.host.js` | Load a graph object into the viewer |
| `window.cy` | `src/core/graph-core.state.js` | Cytoscape.js instance |
| `window.ONEXUS` | `src/helpers/onexus-ns.js` | Main namespace object |
| `window.ONEXUS_UNDO` | `src/core/graph-core.undo.js` | `{ undo, redo, canUndo, canRedo }` |
| `window.setLayerMode(mode)` | `src/core/graph-core.state.js` | Switch layer (relationship/lifecycle/risk/option); also sets `data-onx-layer` on `<html>` |
| `window.getLayerMode()` | `src/core/graph-core.state.js` | Get current layer mode string |
| `window.filterByCategory(cat)` | `src/core/graph-core.filters.js` | Apply category filter |
| `window.ONEXUS_LOG` | `src/helpers/onexus-logger.js` | Debug logger — gated by `ONEXUS_DEBUG` flag |

## Script load order

Modules must load in this order (enforced by `index.html` `<script>` order):

1. `src/helpers/onexus-ns.js` — ONEXUS namespace, `ONEXUS.util.escapeHtml`, event bus
2. `src/helpers/onexus-compat.js` — compatibility shims
3. `src/core/graph-core.state.js` — Cytoscape init, `window.cy`
4. All other `src/core/` and `src/plugins/` modules

Do **not** reorder these. Other modules assume `window.ONEXUS` and `window.cy` are already set.

## URL flags

| Flag | Effect |
|------|--------|
| `?debug=1` | Enable verbose `ONEXUS_LOG` output (same as `window.ONEXUS_DEBUG = true`) |
| `?dev=1` | Load dev-only scripts from `src/dev/` (dep graph, audit, selftest) |
| `?ci=1` | Load dev scripts in CI/headless mode |

## HTML safety — escapeHtml

**Always** escape user-controlled data before inserting into `innerHTML`.

Single source of truth: `ONEXUS.util.escapeHtml(s)` in `src/helpers/onexus-ns.js`.

```js
const esc = window.ONEXUS?.util?.escapeHtml ?? (s => String(s ?? ""));
el.innerHTML = `<div>${esc(node.data("displayLabel"))}</div>`;
```

Never fall back to bare `String(s)` — that is an XSS vector. Use `textContent` or `document.createElement` for single values.

## CSS custom properties (theme tokens)

Theme tokens used throughout `src/helpers/onexus-style.js` and inline styles
(defined in `src/common/onexus-common.css` `:root`):

| Token | Usage |
|-------|-------|
| `--bg-main` | Main canvas/panel background |
| `--bg-soft` | Slightly elevated background |
| `--text-main` | Primary text |
| `--text-muted` | Secondary/dimmed text |
| `--stroke` | Border and divider color |
| `--accent` | Highlight / focus colour (alias of the active `--onx-layer-accent`) |
| `--btn-bg` | Button background |
| `--font-display` | Display face — Archivo (titles, headers, badges) |
| `--font-body` | Body face — IBM Plex Sans |
| `--font-mono` | Data face — IBM Plex Mono (counts, metric values; `tabular-nums`) |
| `--r-sm` / `--r-md` / `--r-lg` / `--r-pill` | Radius scale (`--radius` = `--r-md`) |
| `--grid-dot` / `--grid-size` | Canvas blueprint dot-grid (theme-aware) |

**Layer-semantic accent.** Each layer mode signs the UI via `--onx-layer-accent`,
keyed off a `data-onx-layer` attribute on `<html>` (set in `setLayerMode`,
`graph-core.state.js`): relationship→blue, lifecycle→teal, risk→amber,
option→violet. Use `var(--accent)` for focus rings / highlights so chrome
re-tints with the active layer. Fonts load via a Google Fonts `<link>` in
`index.html` — do not switch back to Inter/system fonts.

### Graph node / label / layout scaling (`src/helpers/onexus-style.js`)

Node size, label size, and layout spacing are **size-proportional and
self-balancing** — don't hardcode constant font/wrap sizes again:

- **Node size**: `nodeBase(deg) = 30 + √deg × 10`, scaled by the global
  `S = window.__onexus_scale`, capped at 200px. Floor of 30 keeps low-degree
  nodes visible (`nodeSizeForEle` applies per-category caps on top).
- **Labels scale with node diameter** (`d`): `nodeFontFor` = `clamp(d×0.22, 7, 14)px`,
  `nodeTextMaxFor` = `clamp(d×1.9, 80, 170)px`. Labels sit **below** the node
  (`text-valign: bottom`) so the node is never hidden behind its text.
- **Layout spacing derives from node sizes** (default `cose`,
  `graph-core.layouts.js`): `idealEdgeLength = 90 + (sourceW+targetW)×0.9`,
  `nodeRepulsion = 9000 + width×450`. Big/high-degree nodes (biggest labels)
  get more room; leaf clusters stay tight. Spacing only updates on a layout
  re-run (Reset Layout / reload).

These four multipliers (`0.22`, `1.9`, `0.9`, `450`) are the tuning knobs.

## Dev-only globals (available with `?dev=1`)

These are loaded only in dev mode and must **not** be referenced in production code:

| Global | File | Purpose |
|--------|------|---------|
| `window.ONEXUS_AUDIT` | `src/dev/onexus-audit.runtime.js` | Runtime global health checks |
| `window.ONEXUS_HOOK_AUDIT` | `src/dev/onexus-audit.hooks.js` | Cytoscape/DOM hook usage report |
| `window.ONEXUS_DEPGRAPH` | `src/dev/onexus-depgraph.js` | Visualise module dependency graph |

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

**Robustness contract (`onexus-backend/server.js`):**
- `readJson()` tags errors so routes map them: missing file → 404, unreadable/
  corrupt JSON → 500 (`"stored graph is corrupted"`). Read directly + catch —
  **no `existsSync()`-then-read** (that's a TOCTOU race).
- `validateGraphShape()` caps element count (`ONEXUS_MAX_ELEMENTS`, default
  200k) and rejects duplicate node ids.
- A JSON error middleware guarantees responses are always JSON: oversized body
  → 413, malformed body → 400, anything else → 500. Never leak an HTML stack trace.
- Env: `PORT` (8787), `ONEXUS_STORAGE_DIR`, `ONEXUS_ALLOWED_ORIGIN`, `ONEXUS_MAX_ELEMENTS`.

**Import resilience (frontend, `graph-core.io.host.js`).** `loadGraphObject` is
the single funnel for all importers: it warns on a 0-node result (empty/
unsupported/failed parse) and confirms before loading >10k-element graphs.
CSV delimiter detection (`cobie-importer.js`) samples several lines and picks
the most *consistent* splitter; edges-CSV header needs `source`+`target` in any
order. `exportJSON` exports the **full** graph (not `:visible`).

## Coding conventions

- Keep vanilla JS — no TypeScript, no React, no build step.
- Prefer small, well-scoped functions; avoid large new files.
- New debug output must use `window.ONEXUS_LOG.log(...)` (gated), not `console.log`.
- `console.warn` and `console.error` are fine for real user-visible signals.
- Tests are kept few and high-signal (see **Running tests**). Only add a
  Playwright test when it would genuinely fail on a real regression — and never
  one with a soft-skip that passes when the feature is missing.
- **Safe-fail pattern:** `try { ... } catch { }` (empty catch) is the approved pattern for optional/plugin integrations where failure should not crash the page. It is intentional, not an oversight.
- **Error handling at boundaries:** Wrap `JSON.parse`, `file.text()`, and external API calls in try-catch with a user-visible `alert` or `console.error`.
- **Performance — bulk Cytoscape ops:** Wrap multi-element class swaps in
  `cy.batch(() => { ... })` to coalesce into one render pass, and set styles on
  a whole collection (`cy.nodes().style(...)`) instead of per-element
  `forEach(n => n.style(...))`. Avoid one query/filter per category in loops —
  tally in a single pass (see the relationship legend in `graph-core.filters.js`).
  Don't add heavy work to high-frequency `cy.on("zoom"|"pan")` handlers without
  a debounce + an early-exit when nothing changed (see `applyLOD`).

## Key plugin APIs

| Symbol | File | Purpose |
|--------|------|---------|
| `ONEXUS.registerPlugin(cfg)` | `src/common/onexus-common.js` | Register a plugin |
| `api.registerImporter(cfg)` | (plugin register callback) | Add a file importer |
| `ONEXUS.plugins.explanations` | Map | Plugin detail-panel templates (node/edge) |
| `ONEXUS.bus.emit(type, detail)` | `src/helpers/onexus-ns.js` | Emit a named event |
| `ONEXUS.bus.on(type, fn)` | `src/helpers/onexus-ns.js` | Subscribe to a named event |

Key bus events: `graphWillLoad`, `graphLoaded`, `graphLoadFailed`, `layerModeChanged`, `languageChanged`, `explainRendered`.

## ONEXUS MCP Server

`onexus-mcp/` is a Python FastMCP server that exposes the vault graph as MCP tools and lets Claude control the live graph via WebSocket.

### Setup
```bash
cd onexus-mcp
pip install -r requirements.txt
# Add to %APPDATA%\Claude\claude_desktop_config.json:
# { "mcpServers": { "onexus": {
#     "command": "python",
#     "args": ["/path/to/onexus/onexus-mcp/server.py"],
#     "env": { "ONEXUS_VAULT_GRAPH": "/path/to/esen-vault/vault-graph.json" }
# } } }
```

The vault graph path resolves from `ONEXUS_VAULT_GRAPH` first (no more hardcoded
`E:\` path), then best-effort fallbacks. Other env knobs: `ONEXUS_WS_PORT`
(8765), `ONEXUS_CONTROL_TIMEOUT` (8s), `ONEXUS_WS_MAX_SIZE` (16 MiB).

### Architecture
- `server.py` runs FastMCP (stdio) with an embedded WebSocket server on `:8765`
- Both run in the **same asyncio event loop** via FastMCP's `lifespan` hook — no threads
- `src/plugins/onexus-mcp-bridge.plugin.js` connects from the browser and dispatches commands to `window.cy`
- A green dot in the bottom-right of ONEXUS shows the connection state

### Critical rules for future edits
- **Do not move WS server to a background thread** — cross-loop scheduling with `asyncio.run_coroutine_threadsafe` causes empty exceptions in FastMCP 3.x tool handlers
- **Control tools must be `async def`** — FastMCP 3.x runs all handlers in its event loop; blocking calls deadlock
- **Use `set.difference_update(other)` not `set -= other`** inside async functions — augmented assignment triggers Python's local-variable scoping rule and raises `UnboundLocalError`
- **vault-graph.json is nested**: `{meta:{}, elements:{nodes:[], edges:[]}}` — unwrap with `raw.get("elements", raw)`
- **Plugin uses `window.ONEXUS.registerPlugin()`** — not `window.ONX`
- **All logging goes to `sys.stderr`** (via `_log`) — stdout is the MCP stdio
  transport; printing graph/debug to stdout corrupts the protocol.
- **`find_path` uses parent-pointer BFS** (no node cap) — don't reintroduce the
  old 5000-node limit that silently returned "not found" on big graphs.
- **Tolerate malformed nodes**: build `_nodes_by_id` with `.get()` (a node
  missing `data`/`id` must not crash startup).
- WS server sets `max_size` (DoS guard) + ping keepalive; pending browser
  requests are failed immediately when the last client disconnects (no leak).

### Known issues (2026-05-16)
- Claude Code shows "Server disconnected" toast briefly on startup — FastMCP banner goes to stderr; `show_banner=False` mitigates but doesn't fully fix
- Old server.py process can survive Claude Code restart and hold port `:8765` — `_free_port()` in lifespan startup kills it, but may race if restart is very fast

### Live graph tools (2026-05-18)
- Snapshot tools (`search_nodes`, `find_path`, `get_graph_summary`, etc.) read the server-side vault graph file.
- Live tools (`get_live_graph_summary`, `search_live_nodes`, `get_live_node`, `get_live_neighbors`, `highlight_live_nodes_by_label`, `select_random_live_nodes`) round-trip through the browser bridge and inspect the currently loaded `window.cy` graph.
- Browser commands must wait for ACKs: the server assigns `_id`, the bridge replies with `{ack, ok, ...}`, and tools should report actual highlighted/missing nodes instead of only "sent".
- Live controls use Cytoscape node IDs. For label-driven use, prefer `search_live_nodes` or `highlight_live_nodes_by_label`.

## Revit Add-in

`Revit_Addin/Onexus/` targets Revit 2026 on .NET 8:

- `Onexus.csproj` is SDK-style `net8.0-windows`, `UseWPF=true`, `UseWindowsForms=true`, `PlatformTarget=x64`.
- Revit references resolve from `C:\Program Files\Autodesk\Revit 2026\`.
- `DeployToRevit` runs after build by default. It copies `Onexus.addin` to `C:\ProgramData\Autodesk\Revit\Addins\2026\` and copies the full output bundle to `C:\ProgramData\Autodesk\Revit\Addins\Onexus\Ver2026\`.
- `Onexus.addin` points to `C:\ProgramData\Autodesk\Revit\Addins\Onexus\Ver2026\Onexus.dll` so WebView2/Newtonsoft dependencies travel with the add-in.
- Visual Studio debug profiles start `C:\Program Files\Autodesk\Revit 2026\Revit.exe` (`Properties/launchSettings.json` and `Onexus.csproj.user`).
- ONEXUS opens as a standalone WPF `OnexusViewerWindow` with WebView2, not as a Revit dockable pane. Keep graph commands routed through `OnexusPaneManager.ShowGraph(...)`; despite the legacy name, it now opens/reuses the standalone viewer window.
- To compile without deploying, run `dotnet build Revit_Addin\Onexus\Onexus.csproj -c Debug -p:DeployToRevit=false`.

## Known gaps / future work

- **IC Supply Chain Dependency Map sample dataset** — create `samples/ic-supply-chain.json` (ONEXUS 1.1 schema) modelling a realistic IC supply chain: `Supplier → Component → Process → Zone → Schedule` nodes with edges `supplies`, `requires`, `blocks`, `installed_in`, `drives`. Source the component data from Kit-of-Parts `advanced-kit.json` (parts already have `supply_risk`, `lead_time`, `sequence` fields). The goal is a concrete killer-use-case demo: "Supplier A delays 3 weeks — call `find_path(supplierA, M7_milestone)` via MCP to highlight everything at risk." Optionally add a thin `ic-supply-importer.plugin.js` for IC-specific node colours (suppliers = orange, schedule = blue, blocked = red). See esen-vault `projects/ONEXUS.md` → Positioning section for context.

- **Playwright tests for Sankey and Chord views** — both views received recent fixes (commits 992ccac, 475e67d, a3581a2) but have zero automated coverage. Add cases to `tests/onexus-features.spec.js`:
  - Sankey view opens without console errors when a flow-data sample is loaded.
  - Chord view renders an SVG overlay; zoom controls work; exiting restores Cytoscape canvas.
  See `src/plugins/onexus-sankeyview.plugin.js` and `src/plugins/onexus-chordview.plugin.js` for the APIs to drive from tests. (Only worth adding if the test would catch a real break — see test philosophy.)

## Changelog — 2026-06-03

UI/UX + hardening pass (branch `claude/amazing-galileo-gg446`):
- **Visual identity**: Archivo + IBM Plex fonts, design tokens (radius scale,
  font tokens), layer-semantic accent system, canvas dot-grid + vignette,
  motion (load fade, popover/meter transitions, MCP dot pulse).
- **Mobile**: compact pill stack, hidden minimap on phones, labeled action grid
  in the "More" menu (icons get captions — no hover tooltips on touch),
  compact selects; unified pill font-weight.
- **Lint/CI**: flat `eslint.config.js`, committed `package-lock.json`.
- **Backend / import / MCP hardening**: see those sections above.
- **Performance**: batched class ops, collection styling, single-pass legend,
  minimap 30→15fps.
- **Graph scaling**: size-proportional labels + layout spacing; labels below
  nodes (see "Graph node / label / layout scaling").
