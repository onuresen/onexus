# ONEXUS — Developer Guide for AI-Assisted Development

This file documents project conventions for Codex and other AI coding tools.

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
npm run test:performance # dedicated 50/500/2000-node benchmark tiers
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

Theme tokens used throughout `src/helpers/onexus-style.js` and inline styles:

| Token | Usage |
|-------|-------|
| `--bg-main` | Main canvas/panel background |
| `--bg-soft` | Slightly elevated background |
| `--text-main` | Primary text |
| `--text-muted` | Secondary/dimmed text |
| `--stroke` | Border and divider color |
| `--accent` | Highlight / focus colour |
| `--btn-bg` | Button background |

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

## Coding conventions

- Keep vanilla JS — no TypeScript, no React, no build step.
- Prefer small, well-scoped functions; avoid large new files.
- New debug output must use `window.ONEXUS_LOG.log(...)` (gated), not `console.log`.
- `console.warn` and `console.error` are fine for real user-visible signals.
- Add Playwright tests in `tests/` for any new feature that affects the **Key public APIs** table above.
- **Safe-fail pattern:** `try { ... } catch { }` (empty catch) is the approved pattern for optional/plugin integrations where failure should not crash the page. It is intentional, not an oversight.
- **Error handling at boundaries:** Wrap `JSON.parse`, `file.text()`, and external API calls in try-catch with a user-visible `alert` or `console.error`.

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

`onexus-mcp/` is a Python FastMCP server that exposes the vault graph as MCP tools and lets Codex control the live graph via WebSocket.

### Setup
```bash
cd onexus-mcp
pip install -r requirements.txt
# Add to %APPDATA%\Codex\claude_desktop_config.json:
# { "mcpServers": { "onexus": { "command": "python", "args": ["E:/GitHub/onexus/onexus-mcp/server.py"] } } }
```

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

### Known issues (2026-05-16)
- Codex shows "Server disconnected" toast briefly on startup — FastMCP banner goes to stderr; `show_banner=False` mitigates but doesn't fully fix
- Old server.py process can survive Codex restart and hold port `:8765` — `_free_port()` in lifespan startup kills it, but may race if restart is very fast

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
- `3D Rooms` is a separate read-only companion exporter, not an ONEXUS graph mutation. Keep its `cdi-room-geometry-v1` DTO/extraction code modular and use stable Revit `UniqueId` values so CDI or another viewer can consume it without coupling mesh data to the graph contract.
- `CDI Rooms` (`OnexusRoomCdiExport.cs` / `OnexusRoomCdiExporter.cs` / `CdiRevitExportContract.cs`) writes `cdi-revit-onexus-export-v1` — a different, older CDI contract than `cdi-room-geometry-v1`. It exists because Autodesk Model Derivative's 3D translation cannot carry Room elements at all (no 3D solid to tessellate), so real Room parameters can only reach CDI through this Revit-side read. It reads every real `room.Parameters` entry present (not a hardcoded field list) and does not touch the `3D Rooms` geometry command.
- To compile without deploying, run `dotnet build Revit_Addin\Onexus\Onexus.csproj -c Debug -p:DeployToRevit=false`.

## Known gaps / future work

### Relationship Intelligence Mode (direction agreed 2026-07-19)

ONEXUS is not an Autodesk/ACC clone and must not become tied to one CDE. Source systems supply records and native relationships; ONEXUS supplies cross-source exploration, impact tracing, hotspot/data-quality analysis, history playback, and an inspectable grounding surface for AI.

Implemented foundation:

1. **Phase 2A shipped:** `src/ui/graph-ui.relationshipIntelligence.js` provides search, Dim/Hide non-matches, impact depth Off/1/2/3/All, ranked hotspots, data health, truth-class counts, dated playback, and contextual deep links.
2. **Phase 2B shipped:** `ONEXUS.import.normalizeRelationship(data)` produces the backward-compatible `onexus.relationship.v1` envelope with source identity, provenance/evidence, truth class, confidence, validity, review state, and deleted-reference lifecycle. The JSON schema documents the optional envelope; ONEXUS 1.x edges remain valid.

Next bounded phases:

3. **Phase 2C feasibility adapter shipped:** `src/plugins/onexus-aps-relationships.plugin.js` maps saved APS responses and supports injected authenticated pagination. It never stores tokens, constructs undocumented endpoint URLs, or assumes relationship pairs are writable. Keep production OAuth in a trusted backend/connector. Real-tenant payload and module coverage validation remains open.
4. Integrate OneRoot as the governed judgment layer: decisions, evidence, alternatives, approvals, validity conditions, and ontology changes can create or review relationships without losing source truth.
5. Add GraphRAG only after retrieval can return the path, source, evidence, and review state used for an answer.

**Phases 2D and 2E shipped:** `onexus-oneroot-governance.plugin.js` provides backward-compatible OneRoot package defaults and explicit inferred-edge approve/reject actions with audit history. `onexus-mcp/grounding.py`, `get_grounded_path`, and `get_live_grounded_path` return inspectable paths and exclude deleted/rejected relationships by default. These are grounding primitives, not a free-form chatbot; generated prose must stay downstream of the returned evidence contract.

Relationship truth classes must stay visually and semantically distinct: `source-native`, `governed`, `project-defined`, `inferred`, `decision-created`, and `historical`. Never promote an AI-inferred edge to authoritative status without an explicit human review action.

- **Large-graph performance** — the dedicated baseline currently takes roughly 49 seconds for 2,000 nodes / 6,000 edges on the development machine. Use `npm run test:performance` before and after scale-related changes; do not loosen budgets to conceal regressions.
- **Story presentation mode** — the next product-quality slice should reduce unrelated chrome during guided playback and restore the prior workspace on exit.
- **Scenario flexibility** — add generic scenario actions and semantic references only when the three flagship stories demonstrate a repeated need. Keep story definitions data-driven.
