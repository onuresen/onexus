# ONEXUS – Relationship Layer (Revit Add‑in Companion Viewer)

![ONEXUS Banner](assets/banner.png)

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Cytoscape.js](https://img.shields.io/badge/Cytoscape.js-3.23-blue)
![Revit Add‑in](https://img.shields.io/badge/Revit-Add--in-orange)
![Made for BIM](https://img.shields.io/badge/BIM-NEXUS-blueviolet)

</div>

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
- Tooltip previews
- Real-time graph interaction

### 🔹 Animation & Transitions
- Smooth node position animations
- Edge path animations
- Layout transition effects
- Node highlight animations
- Fade-in/fade-out effects for visibility changes

### 🔹 Node & Edge Management
- **Create Nodes** — dynamically add new nodes to the graph
- **Create Edges** — establish relationships between nodes
- **Delete Nodes** — remove nodes and auto-cleanup connected edges
- **Delete Edges** — remove relationships while maintaining nodes
- Batch operations on selected nodes/edges
- Undo/Redo support for all modifications

### 🔹 Edit & Property Options
- **Node Editing** — modify node label, category, and properties
- **Edge Editing** — edit edge type, label, and direction
- Context menu (right-click) for quick actions
- Inline property editing
- Multi-select editing for bulk updates
- Validation and constraint enforcement

### 🔹 Multiple Layout Modes
- **Free / Organic** (COSE)
- **System Atlas** (systems as roots)
- **Responsibility Atlas** (organizations as roots)
- **Spatial Stack** (spaces as roots)
- Layout animation and smooth transitions

### 🔹 Multi-Language Support
- English (`en`)
- Japanese (`jp`)

### 🔹 Filtering & Lenses
- Category filter
- Relationship dimension lens
- Phase filter (multi-select)
- Node search (auto-fit)
- Drag-and-drop JSON loading
- Focus depth (1-hop / 2-hop)

### 🔹 Theming
- Light & Dark theme
- Automatic recoloring of nodes/edges
- Auto-updating legend
- Customizable color schemes

### 🔹 Export & Data Tools
- Export **PNG**, **SVG**, **JSON**, **CSV**, **Layout JSON**
- Automatic timestamp metadata
- Save work-in-progress states
- Import/Export layout configurations

---

## 📁 Directory Structure
```
README.md                   # Project overview and usage (this file)
index.html                  # Main demo page / UI loader
src/                        # Application source code
  core/                     # Graph core logic (layouts, graph ops)
  importers/                # Data importers (COBie, IFC, CSV, GD)
  ui/                       # UI bindings and loader scripts
  helpers/                  # Small utilities and style helpers
json/                       # Sample JSON datasets used by demos
samples/                    # Example datasets and raw exports (COBie, IFC, etc.)
assets/                     # Images, WASM and miscellaneous media (see folder)
versions/                   # Archived snapshots / historical builds
```

---

## 📦 Installation & Usage
This project runs entirely in the browser — there is no build step. Follow one of the simple options below.

Option A — Open directly (quickest)
- On Windows: double-click `index.html` or right-click and choose "Open with" → pick Chrome/Edge/Firefox.
- Note: some browsers restrict loading local files (especially `.ifc`). If a file won't load, use Option B.

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
- Language: switch UI language (English / Japanese).
- View / Layout: pick a layout preset to rearrange the graph with smooth animations.
- Theme: Light / Dark mode toggle.
- Pan / zoom: drag to pan, mouse wheel to zoom; use the minimap to jump around.
- Keyboard shortcuts: `F` = Fit view, `C` = Center, `R` = Reset layout, `Delete` = Remove selected node/edge.

Creating & Editing Elements
- **Add Node** — right-click on canvas or use the toolbar button to create a new node.
- **Add Edge** — select two nodes and right-click to create an edge between them.
- **Edit Properties** — double-click any node or edge to open the property editor and modify its attributes.
- **Delete Elements** — select and press `Delete` or right-click → Remove.
- **Multi-select** — hold `Ctrl` and click nodes/edges, then batch edit or delete.
- **Undo/Redo** — use `Ctrl+Z` / `Ctrl+Shift+Z` to undo/redo any changes.

Exporting
- Use the export buttons in the toolbar to save the current view or data as PNG, SVG, JSON (layout + metadata) or CSV.
- Exported layouts can be re-imported to restore the exact graph structure and positions.

Troubleshooting
- If a drag-and-drop or IFC import fails, try the file selector or open the demo via a local server (Option B).
- For large IFC files, try smaller samples from `samples/ifc` or pre-convert data into the JSON schema in `json/`.

Option C — GitHub Pages
- To publish the demo online, enable GitHub Pages for this repository and point to the project root or `index.html`.

---

## 🧩 JSON Schema Summary

Each ONEXUS data file follows this minimal structure:

```json
{
  "meta": {
    "schema": "onexus-1.x",
    "project": "Project Name",
    "timestamp": "2026-02-10T00:00:00Z"
  },
  "elements": {
    "nodes": [
      {
        "id": "node-1",
        "nodeType": "Element",
        "category": "Wall",
        "label": "Wall A",
        "properties": {}
      }
    ],
    "edges": [
      {
        "id": "edge-1",
        "source": "node-1",
        "target": "node-2",
        "type": "contains",
        "label": "Contains"
      }
    ]
  }
}
```

- **Node basics**: `id`, `nodeType`, `category`, `label` (supports multi-language keys), properties object
- **Edge basics**: `id`, `source`, `target`, `type`, `label`
- All timestamps are ISO 8601 format
- Properties can include any custom metadata

---

## 🚀 Quick Development Guide

**Editing the application:**
- Core graph logic: [src/core/graph-core.js](src/core/graph-core.js)
- UI bindings & interactions: [src/ui/graph-ui.bindings.js](src/ui/graph-ui.bindings.js)
- Styling: [src/helpers/onexus-style.js](src/helpers/onexus-style.js)
- Data importers: [src/importers/](src/importers/)

**Running during development:**
- Open [index.html](index.html) directly, or use a local server (`npx http-server .`)
- Changes will be reflected on page refresh

**Adding new features:**
1. Add logic to the appropriate module in `src/core/` or `src/ui/`
2. Update [src/ui/graph-ui.bindings.js](src/ui/graph-ui.bindings.js) for UI events
3. Update styling in [onexus-style.js](src/helpers/onexus-style.js) as needed
4. Test with sample JSON files in `json/` folder

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