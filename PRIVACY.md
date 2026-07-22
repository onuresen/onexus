# Privacy & Data Handling

This describes what data ONEXUS holds, where it lives, and what — if anything —
leaves the browser. ONEXUS is a static browser app with **no accounts, no
server-side storage of its own, no telemetry, and no analytics.**

## Summary

- **A default page load sends no data anywhere off the app's own origin.** No
  fonts, libraries, trackers, or beacons — all self-hosted (regression-tested in
  `tests/onexus-egress.spec.js`).
- Your graph data is processed **in the browser** (`window.cy`) and is not
  uploaded unless *you* use the optional backend or export a file yourself.
- The only optional outbound destinations are the local MCP bridge and, if
  enabled and used with your own key, the Anthropic API. Full table below.

## Data categories & where they live

| Category | Where | Notes |
|---|---|---|
| **Imported graph data** (nodes/edges from JSON, IFC, COBie, CSV, Obsidian vault) | In-memory (`window.cy`) only | Read client-side. Not persisted to disk or uploaded by default. Cleared on page reload. |
| **UI preferences** | `localStorage` (this browser) | Theme/color mode, node scale, layer mode, autosave toggle, hidden-node set, badge settings, inspector position, "tour seen", safe-mode flag, label-perf preference. Keys are prefixed `onexus.*` / `onx.*`. No graph content. |
| **Last-opened reference** | `localStorage` (`onexus.persist.lastId`, `onexus.persist.lastName`) | Only an id/name pointer, and only meaningful if you use the optional backend. |
| **Anthropic API key (secret)** | `localStorage` (`onexus.ai.v1`) | Present **only** if you enable AI and enter your own key. Stored in plaintext in this browser. Sent only to Anthropic. See "Secrets." |
| **Exported files** | Wherever you save them | PNG / SVG / JSON / CSV you explicitly export. Not encrypted. |
| **Graphs saved to the optional backend** | The backend's disk (`ONEXUS_STORAGE_DIR`) | Only if you run and use `onexus-backend/`. It stores graph JSON as files. See its section below. |

There are **no cookies** set by ONEXUS and no third-party storage.

## Egress table (every possible outbound request)

| Destination | Trigger | Payload | Default |
|---|---|---|---|
| App's own origin (`'self'`) | Page load; loading sample/scenario JSON you select | Static assets and sample files | Always (same-origin) |
| `ws://localhost:8765` | You run the optional MCP server; the browser bridge auto-connects | Graph control/query messages between the local server and the page | Off unless you run the server |
| `https://api.anthropic.com` | AI enabled in deployment policy **and** you entered your own key **and** you clicked "What-if?" narration | A graph-impact summary (origin node label + BFS of affected node labels/categories) and your prompt, plus your API key in the request header | **Off by user default** (no key = no request); removable entirely by deployment policy |
| The optional backend's address | You save/load a graph to `onexus-backend/` | The graph JSON | Off unless you run and use it |

No other host is contacted. If you disable AI (`ai.enabled: false` in
`src/config/onexus-enterprise.config.js`) and don't run the MCP/backend servers,
ONEXUS makes **zero** off-origin requests, period.

## Secrets

- The **Anthropic API key** is the only secret ONEXUS stores. It is kept in this
  browser's `localStorage` (`onexus.ai.v1`) in plaintext and is transmitted only
  to `https://api.anthropic.com` when you invoke AI. It is **not** included in
  any graph export. To remove it: clear the AI key in the 🔮 panel, clear site
  data in your browser, or deploy with AI disabled.
- The APS (Autodesk) adapter **never stores an access token**: OAuth is
  deliberately not implemented in browser code, and live retrieval requires an
  authenticated `fetch` injected from a trusted backend/connector. ONEXUS neither
  requests nor persists Autodesk credentials.

## Retention, deletion, portability

- **Retention:** in-memory graph data is gone on reload. `localStorage`
  preferences persist until you clear them.
- **Deletion:** clear browser site data for the ONEXUS origin to remove all
  local preferences and any stored key. Backend-stored graphs are deleted through
  the backend / by removing its files.
- **Portability:** export your graph as JSON (the full graph, not just what's
  visible) at any time. ONEXUS does not lock you in.

## The optional backend & hosting logs

- `onexus-backend/` stores graphs as files on the operator's disk. It has **no
  authentication by design** (local/trusted-network only) and keeps no user
  identities. See `SECURITY.md` and `docs/DEPLOYMENT.md`.
- Whatever static host serves ONEXUS (e.g. GitHub Pages, nginx) may keep its own
  **access logs** (IP, timestamp, requested path) — that is a property of the
  hosting layer, outside ONEXUS's control, and applies to any website. ONEXUS
  adds no logging of its own.

## What ONEXUS does NOT do

- No analytics, telemetry, crash reporting, or usage tracking.
- No advertising or third-party trackers.
- No background upload of your data.
- No account system and no server-side profile.
