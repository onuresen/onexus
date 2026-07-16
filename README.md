# ONEXUS — Graph Intelligence Layer

![ONEXUS Banner](assets/banner.png)

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Cytoscape.js](https://img.shields.io/badge/Cytoscape.js-3.23-blue)
![MCP](https://img.shields.io/badge/MCP-FastMCP-7c3aed)
![Python](https://img.shields.io/badge/Python-3.10+-yellow)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-483699)
[![CI](https://github.com/onuresen/onexus/actions/workflows/onexus-smoke.yml/badge.svg)](https://github.com/onuresen/onexus/actions/workflows/onexus-smoke.yml)

*Browser-based relationship graph with live AI/MCP control — for BIM, Obsidian vaults, and beyond.*

</div>

---

## What is ONEXUS?

ONEXUS turns any structured dataset — a BIM model, an Obsidian vault, a COBie export — into a live, queryable knowledge graph. What makes it different: **you can ask Claude to explore it**. Tell Claude to trace the dependency path between two systems, highlight every high-risk node, or push a custom graph live into the browser — and it happens in real time.

> **"What is related to what — and *why*?"**

It does **not** replace any CDE or existing tool. It exposes the hidden, implicit relationships that live in your data and makes them visible, explorable, and explainable.

Works standalone (open `index.html`, drag-and-drop your data) or wired to Claude via the MCP server.

---

## Use Cases

### BIM / Revit
Load an IFC or COBie export and instantly see system, spatial, and responsibility relationships. Use the Revit add-in to push live model data directly from Revit 2026 into the browser viewer. Ask Claude:

```
Which mechanical components are in Zone B and have a risk flag?
→ search_live_nodes("Zone B") → filter_to_subgraph → highlight_nodes
```

### Obsidian Vault
Drop your vault folder onto ONEXUS — every note becomes a node, every `[[wikilink]]` becomes an edge. Folder structure auto-maps to node categories (projects/, concepts/, daily/, etc.). Ask Claude:

```
Show me the path between the VIKTOR project and BHoM.
→ find_path("projects/VIKTOR.md", "concepts/BHoM.md") → focus_node on each hop
```

### Project Risk Tracing
Import any custom JSON with `risk` and `phase` metadata. Switch to the **Risk** layer to surface high-confidence risk edges. Ask Claude to isolate the blast radius of a delay:

```
Filter to only the risk-flagged nodes and apply dependency flow layout.
→ get_by_category("Risk") → filter_to_subgraph(ids) → set_layout("dependency_flow")
```

---

## MCP / AI Integration

ONEXUS ships a Python MCP server that gives Claude two capabilities over any loaded graph: querying the vault graph file (no browser needed) and directly controlling the live graph in the browser.

### Architecture

```
Claude Code  ──stdio──►  server.py (FastMCP)
                              │
                         WebSocket :8765
                              │
                    ONEXUS browser tab
                 (onexus-mcp-bridge.plugin.js)
                              │
                         Cytoscape.js
```

### Quick Setup

**1. Install Python dependencies**
```bash
cd onexus-mcp
pip install -r requirements.txt
```

**2. Register with Claude Code / Claude Desktop**

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "onexus": {
      "command": "python",
      "args": ["/path/to/onexus/onexus-mcp/server.py"]
    }
  }
}
```

**3. Open ONEXUS in your browser** — a green dot appears in the bottom-right corner when the bridge is connected.

### Available Tools

| Layer | Tools |
|---|---|
| **Snapshot** (no browser needed) | `get_graph_summary`, `search_nodes`, `get_node`, `get_neighbors`, `find_path`, `get_by_category`, `get_edge_types` |
| **Live query** (browser open) | `get_live_graph_summary`, `search_live_nodes`, `get_live_node`, `get_live_neighbors` |
| **Live control** (browser open) | `focus_node`, `highlight_nodes`, `highlight_live_nodes_by_label`, `filter_to_subgraph`, `reset_view`, `set_layout`, `load_focused_graph` |

Full tool reference: [`onexus-mcp/README.md`](onexus-mcp/README.md)

---

## Features

| Category | What you get |
|---|---|
| **Graph engine** | Pan/zoom, minimap, path tracing, A/B comparison, undo/redo |
| **Importers** | ONEXUS JSON, IFC/IFCZIP, COBie CSV, Edges CSV, Obsidian vault, Generative Design JSON |
| **Layer modes** | Relationship, Lifecycle (phase timeline + playback), Risk, Option |
| **Layouts** | 10+ presets: cose, tree, swimlanes, degree rings, dependency flow, system/spatial/responsibility atlases |
| **Filtering** | Category filter, relationship lens, phase filter, focus depth (1–3 hops), node search |
| **Theming** | Light / Dark, auto-updating legend, multilingual (EN / JP) |
| **Export** | PNG, SVG, JSON, CSV, Layout JSON |
| **Plugins** | Register importers, edge types, UI extensions via `src/plugins/manifest.json` |

<details>
<summary>Layer Modes — detailed guide</summary>

### Relationship (default)
Best for exploring "what relates to what" using semantic dimensions and types.
1. Use **Lens** (dimension) to focus System / Spatial / Responsibility / Vendor edges.
2. Click **Legend** items to toggle relationship-type filtering.
3. Use **Focus depth** to isolate local neighborhoods.

### Lifecycle (phase-aware)
Best for understanding how relationships appear/solidify across project phases.
- Edge data should include `"phase": ["BasicDesign", "DetailedDesign"]`
- Optional: `meta.phases` defines the ordered phase timeline
- Lifecycle controls appear as a floating panel (bottom-left) opened via **Layer Widget → Quick Actions**
- Supports: Exact / Cumulative reveal, hide isolated nodes, show unphased edges, timeline playback

### Risk
Best for highlighting risk/confidence signals. Switch to Risk layer, use quick actions to filter inferred-only or high-risk edges, use legend/metrics to validate what's visible.

### Option
Best for exploring design options and GD-driven variants. Import a GD payload (Overlay to attach metrics to existing nodes, or Materialize to create Option nodes + Optimizes edges), then switch to Option layer.

</details>

---

## Revit Add-in

The `Revit_Addin/` folder contains a .NET 8 WPF host window with WebView2 that embeds the ONEXUS browser viewer directly inside Revit 2026. The add-in pushes live model data from Revit into the graph viewer via `window.onexusLoadGraph(data)`.

- Solution: `Revit_Addin/Onexus/Onexus.csproj` — targets `net8.0-windows`, Revit 2026
- Build without deploying: `dotnet build Revit_Addin\Onexus\Onexus.csproj -c Debug -p:DeployToRevit=false`

---

## Getting Started

This project runs entirely in the browser — no build step required.

**Option A — Open directly (quickest)**
- Double-click `index.html` or open it in Chrome / Edge / Firefox.
- Note: some browsers restrict local file access (especially `.ifc`). Use Option B if a file won't load.

**Option B — Local static server (recommended)**
```bash
npx http-server -p 4173 .
# then open http://localhost:4173
```
Or with Python: `python -m http.server 4173`

**Load your first graph**
- Drag-and-drop any supported file onto the page, or use the `Load` button in the toolbar.
- Try `samples/json/onexus_sample.json` to see a working graph immediately.

<details>
<summary>Keyboard shortcuts</summary>

| Key | Action |
|---|---|
| `F` | Fit view |
| `C` | Center |
| `R` | Reset layout |
| `Delete` | Remove selected node(s) |
| `Alt+D` | Duplicate selected node(s) |
| `Ctrl/Cmd+Z` | Undo |
| `Shift+Ctrl/Cmd+Z` or `Ctrl/Cmd+Y` | Redo |
| `Ctrl+Shift+R` | Reset preferences (clears cached settings) |
| `Shift+Drag` | Box-select nodes and edges |
| `Shift+Ctrl/Cmd+Drag` | Additive box-select |

</details>

---

## JSON Schema

Each ONEXUS data file follows this minimal structure:

```json
{
  "meta": {
    "schema": "onexus-1.x",
    "project": "Project Name",
    "timestamp": "2026-02-10T00:00:00Z",
    "phases": ["Concept", "Design", "Construction"]
  },
  "elements": {
    "nodes": [
      { "data": {
        "id": "node-1",
        "nodeType": "Component",
        "category": "Door",
        "label": { "en": "Door A", "jp": "ドアA" }
      } }
    ],
    "edges": [
      { "data": {
        "id": "edge-1",
        "source": "node-1",
        "target": "node-2",
        "type": "Controls",
        "dimension": "System",
        "directional": true,
        "phase": ["Design", "Construction"],
        "risk": "High",
        "confidence": "Explicit"
      } }
    ]
  }
}
```

- `label` supports multi-language keys (`{ en, jp }`)
- Extra fields are preserved and may be used by plugins
- The `load_focused_graph` MCP tool accepts the same schema — Claude can construct and push a custom graph into the live viewer programmatically

Converting your own data? Click the **Download JSON Schema** toolbar button (or
grab [`schemas/onexus-graph.schema.json`](schemas/onexus-graph.schema.json)
directly) and hand it to any AI assistant along with your data — the schema
is written to be self-explanatory for that purpose.

---

## Directory Structure

```text
index.html              # Main entry page
src/
  core/                 # Graph engine (state, layouts, filters, layers, undo, path)
  plugins/              # Plugin scripts + manifest.json
  ui/                   # UI bindings and widgets
  helpers/              # Utilities and styling
  common/               # Shared CSS/JS and boot check
onexus-mcp/             # Python MCP server (FastMCP + WebSocket bridge)
onexus-backend/         # Optional Express.js graph storage server
Revit_Addin/            # .NET 8 WPF Revit 2026 add-in
samples/                # Example datasets (JSON, COBie, IFC)
assets/                 # Images, WASM, and media
tests/                  # Playwright end-to-end tests
```

---

## Dev & Diagnostics

<details>
<summary>URL flags for development</summary>

| Flag | Effect |
|---|---|
| `?debug=1` | Verbose `ONEXUS_LOG` output |
| `?dev=1` | Load dev overlays: dep graph, audit, self-tests |
| `?ci=1` | Dev checks in CI/headless mode |

Run tests: `npm run test:smoke` (requires `npx playwright install --with-deps chromium` and a running server).

</details>

---

## Contributing

PRs, issue reports, and enhancements are welcome. Please:
- Keep changes focused; test with multiple sample datasets
- Update this README if you add major features or change workflows
- Add Playwright tests in `tests/` for anything that affects the public API

For AI-assisted development, see [`CLAUDE.md`](CLAUDE.md) for project conventions and key APIs.

---

## License

[MIT License](LICENSE) — freely usable and modifiable for any purpose.
