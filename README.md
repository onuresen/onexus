# ONEXUS – Relationship Layer (Revit Add‑in Companion Viewer)
![ONEXUS Banner](assets/banner.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Cytoscape.js](https://img.shields.io/badge/Cytoscape.js-3.23-blue)
![Revit Add‑in](https://img.shields.io/badge/Revit-Add--in-orange)
![Made for BIM](https://img.shields.io/badge/BIM-NEXUS-blueviolet)

---

## 🌐 Overview

**ONEXUS** is a lightweight, browser‑based visualization layer that reveals **relationships between BIM elements, systems, spaces, and organizations**. It runs entirely in the browser (no build step) and is designed to make “what relates to what — and why?” easy to inspect and iterate.
It was originally built as a companion viewer for a Revit add-in, but it works independently.

ONEXUS answers a simple but powerful question:

> **“What is related to what — and *why*?”**

It does **not** replace any CDE or tool. Instead, it exposes hidden or implicit relationships in a clean, powerful visual map.

The goal is simple:

> **Make implicit BIM relationships visible, explorable, and explainable.**
---

## Key Concepts

- **Nodes** represent BIM entities (components, systems, spaces, organizations, vendors, options, etc.)
- **Edges** represent relationships (system, spatial, responsibility, lifecycle, risk, dependency, etc.)
- The **same graph** can be viewed through multiple semantic perspectives using *Layer Modes*

## ✨ Features

### 🔹 Interactive Graph Engine
- Smooth pan / zoom with minimap
- Multiple layout presets (organic, tree, swimlanes, dependency flow, etc.)
- Path tracing (upstream / downstream / shortest path)
- A/B graph comparison

### 🔹 Layers (Semantic Views)
- **Relationship** — default semantic relationship view
- **Lifecycle** — phase‑aware visualization with timeline controls
- **Risk** — highlight risk and confidence signals
- **Option** — explore design or generative‑design alternatives

> One graph, multiple perspectives.

### 🔹 Interactive Editing
- Create and delete nodes and relationships
- Context menus for quick actions
- Full **Undo / Redo** support for graph mutations

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

### 🔹 Importers (Plugin‑based)
- ONEXUS JSON (native graph format)
- Edges CSV
- COBie CSV (multi‑file)
- IFC / IFCZIP (via web‑ifc)
- Generative Design (GD) JSON (overlay or materialize options)

### 🔹 Export
- PNG / SVG (visual output)
- JSON / CSV (data)
- Layout JSON (positions + structure)
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
index.html                # Main entry page
src/
  core/                   # Graph core (state, layouts, filters, layers, undo, path)
  plugins/                # Plugin scripts + manifest
  ui/                     # UI bindings and widgets
  helpers/                # Utilities and styling
  common/                 # Shared css/js
samples/                  # Example datasets and raw exports (json, COBie, IFC, etc.)
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

Notes:
- `label` supports multi‑language keys (commonly `{ en, jp }`)
- Extra fields are preserved and may be used by plugins
- Lifecycle layer works best when `meta.phases` is defined

---

## Plugin Architecture

ONEXUS is intentionally extensible.

Plugins can:
- Register importers
- Add edge‑type labels (i18n)
- Add explanations or trace behaviors
- Extend UI behavior without modifying core code

Plugins are loaded via `src/plugins/manifest.json`.

---

## Dev & Diagnostics (Optional)

Some tooling is query‑gated:

- `?dev=1` — enables dev overlays, audits, and self‑tests
- `?ci=1` — enables checks suitable for CI‑like runs

This helps keep the default UI clean while retaining deep introspection tools.

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