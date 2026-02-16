# ONEXUS – Relationship Layer (Revit Add‑in Companion Viewer)
![ONEXUS Banner](assets/banner.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Cytoscape.js](https://img.shields.io/badge/Cytoscape.js-3.23-blue)
![Revit Add‑in](https://img.shields.io/badge/Revit-Add--in-orange)
![Made for BIM](https://img.shields.io/badge/BIM-NEXUS-blueviolet)

---

## 🌐 Overview

**ONEXUS** is a lightweight, browser‑based visualization layer that reveals **relationships between BIM elements, systems, spaces, and organizations**. It is the companion viewer for a Revit add‑in, using **Cytoscape.js** to produce an interactive, explorable semantic graph.

ONEXUS answers a simple but powerful question:

> **“What is related to what — and *why*?”**

It does **not** replace any CDE or tool. Instead, it exposes hidden or implicit relationships in a clean, powerful visual map.

---

## ✨ Features

### 🔹 Interactive Graph Engine
- Smooth pan/zoom
- Level-of-detail rendering (LOD)
- Dynamic node sizing
- Real-time graph interaction

### 🔹 Layers (Semantic Views)
ONEXUS supports multiple **Layer Modes**. Each layer is a “purposeful view” on the same graph data.

- **Relationship** *(default)* — explore semantic relationship types & dimensions.
- **Lifecycle** — phase-aware view; filter and play through phases.
- **Risk** — emphasize risk/confidence signals and filtering.
- **Option** — decision / generative design option exploration.

> **Layer Widget** (bottom-left): shows current layer and provides layer-specific **Quick Actions** (no need to crowd the top toolbar).

### 🔹 Node & Edge Management
- **Create Nodes** — dynamically add new nodes to the graph
- **Create Edges** — establish relationships between nodes
- **Delete Nodes** — remove nodes and auto-cleanup connected edges
- **Delete Edges** — remove relationships while maintaining nodes
- Undo/Redo support for graph modifications
- Context menu (right-click) for quick actions

### 🔹 Multiple Layout Modes
- **Free / Organic** (COSE)
- **System Atlas** (systems as roots)
- **Responsibility Atlas** (organizations as roots)
- **Spatial Stack** (spaces as roots)
- Additional presets (e.g., Tree/Nested, Swimlanes, Degree Rings, Dependency Flow)

### 🔹 Multi-Language Support
- English (`en`)
- Japanese (`jp`)

### 🔹 Filtering & Lenses
- Category filter
- Relationship dimension lens
- Phase filter (works with Lifecycle layer)
- Node search (auto-fit)
- Focus depth (1-hop / 2-hop / 3-hop)
- Drag-and-drop loading

### 🔹 Theming
- Light & Dark theme
- Automatic recoloring of nodes/edges
- Auto-updating legend

### 🔹 Export & Data Tools
- Export **PNG**, **SVG**, **JSON**, **CSV**, **Layout JSON**
- Save work-in-progress states
- Import/Export layout configurations

### 🔹 Importers
- ONEXUS JSON
- COBie CSV
- IFC / IFCZIP (web-ifc)
- Generative Design (GD) payloads (overlay or materialize option edges)

---

## 🧭 Layer Modes (How to Use)

### ✅ Relationship (default)
Best for: exploring “what relates to what” using semantic dimensions and types.

**Typical workflow**
1. Use **Lens** (dimension) to focus System/Spatial/Responsibility/Vendor edges.
2. Click **Legend** items to toggle relationship-type filtering.
3. Use **Focus depth** to isolate local neighborhoods.

### ✅ Lifecycle (phase-aware workflow)
Best for: understanding how relationships appear/solidify across project phases.

**Requirements**
- Edge data should include `phase` as an array (or string), e.g. `"phase": ["BasicDesign", "DetailedDesign"]`
- Optional: `meta.phases` defines the **ordered phase timeline**.

**Controls**
- Lifecycle controls appear as a **floating panel (bottom-left)**.
- The panel is opened/closed via **Layer Widget → Quick Actions** (“Lifecycle panel”).
- Supports:
  - **Exact** phase view
  - **Cumulative** reveal (show phases up to the current one)
  - Hide isolated nodes
  - Show unphased edges
  - Play through phases (timeline playback)

> Safety: If no phases exist in the loaded graph, Lifecycle automatically falls back to Relationship.

### ✅ Risk
Best for: highlighting risk/confidence signals (data-driven styling and filtering).

**Typical workflow**
- Switch to **Risk** layer
- Use quick actions to filter inferred-only or high-risk edges (when present)
- Use legend/metrics to validate what is visible

### ✅ Option
Best for: exploring design options and GD-driven variants.

**Typical workflow**
- Import GD payload:
  - **Overlay**: attach GD metrics to existing nodes/edges
  - **Materialize**: create Option nodes + Optimizes edges
- Switch to **Option** layer to focus option roots and neighborhoods

---

## 📁 Directory Structure

```text
README.md                 # Project overview and usage (this file)
index.html                # Main demo page / UI loader (right sidebar)
index_leftRail.html       # Alternate UI (left rail + drawer + overlays)
src/
  core/                   # Graph core logic (state, layouts, filters, layers, io)
  importers/              # Data importers (COBie, IFC, CSV, GD)
  ui/                     # UI bindings and loader scripts
  helpers/                # Small utilities and style helpers
  common/                 # Shared css/js
json/                     # Sample JSON datasets used by demos
samples/                  # Example datasets and raw exports (COBie, IFC, etc.)
assets/                   # Images, WASM and miscellaneous media
versions/                 # Archived snapshots / historical builds

---

## 📦 Installation & Usage
This project runs entirely in the browser — there is no build step. Follow one of the simple options below.

Option A — Open directly (quickest)
- On Windows: double-click index.html or right-click and choose "Open with" → pick Chrome/Edge/Firefox.
- Note: some browsers restrict loading local files (especially .ifc). If a file won't load, use Option B.

Option B — Run a local static server (recommended)
- With Node (no install required if you have Node):
```bash
npx http-server .
```
- Or with Python 3:
```bash
python -m http.server 8080
```
- Then open:
```text
http://localhost:8080
```

Loading data (beginner steps)
- Use the `Load` file selector in the toolbar or drag-and-drop files onto the page.
- Start with the included sample JSON: `json/onexus_sample.json` to see a working graph.
- Supported file types: `.json` (ONEXUS graph), `.csv` (tabular imports), `.ifc` (IFC model imports). Multiple files are allowed.

Basic controls
- Language: switch UI language (English / Japanese)
- Layer: switch layer mode (Relationship/Lifecycle/Risk/Option)
- Layout: pick a layout preset to rearrange the graph with smooth animations
- Theme: Light / Dark mode toggle
- Pan/zoom: drag to pan, mouse wheel to zoom; minimap to jump around

Keyboard shortcuts
- F = Fit view
- C = Center
- R = Reset layout
- Delete = Remove selected node(s)
- Ctrl/Cmd+Z = Undo
- Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y = Redo

Exporting
- Use the export buttons in the toolbar to save the current view or data as PNG, SVG, JSON (layout + metadata) or CSV.
- Exported layouts can be re-imported to restore the exact graph structure and positions.

---

## 🧩 JSON Schema Summary

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
        "owner": "Electrical",
        "risk": "High",
        "confidence": "Explicit",
        "notes": "Why this relationship exists"
      } }
    ]
  }
}
```

Node basics
- id, nodeType, category
- label supports multi-language keys: { en, jp }
- Any additional properties are allowed and preserved

Edge basics
- id, source, target
- type, dimension, directional
- Optional lifecycle fields: phase (string or array)
- Optional decision fields: risk, confidence, owner, notes
---


## 🧪 Lifecycle Data Tips (Recommended)
To make the Lifecycle layer useful:
- Set meta.phases to define the ordered timeline.
- Add phase to edges as an array (recommended) for multi-phase validity.
- Leave some edges unphased intentionally if you want to test “Show unphased”.

## 🚀 Quick Development Guide

**Editing the application:**
- Core graph logic: src/core/
- UI bindings & interactions: src/ui/graph-ui.bindings.js
- Styling: src/helpers/onexus-style.js and src/common/onexus-common.css
- Data importers: src/importers/

**Running during development:**
- Open [index.html](index.html) directly, or use a local server (`npx http-server .`)
- Changes will be reflected on page refresh

**Adding new features:**
1. Add logic to the appropriate module in src/core/ or src/ui/
2. Prefer layer-specific behavior via registerLayerMode(...) and layer actions
3. Keep UI minimal: use Layer widget actions instead of expanding the top toolbar
4. Update README if you add major features or change workflows

---

## 📝 Contributing

PRs, issue reports, and enhancements are welcome! Please:
- Keep code changes focused and well-commented
- Test with multiple sample datasets
- Update the README if you add major features or change workflows
- Reference any issues or feature requests in your PR description

---

## 📜 License

[MIT License](LICENSE) — freely usable and modifiable for any purpose.