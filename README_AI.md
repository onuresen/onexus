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

### 🔹 Multiple Layout Modes
- **Free / Organic** (COSE)
- **System Atlas** (systems as roots)
- **Responsibility Atlas** (organizations as roots)
- **Spatial Stack** (spaces as roots)

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

### 🔹 Export Tools
- Export **PNG**, **SVG**, **JSON**, **CSV**, **Layout JSON**
- Automatic timestamp metadata

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
- View / Layout: pick a layout preset to rearrange the graph.
- Theme: Light / Dark mode.
- Pan / zoom: drag to pan, mouse wheel to zoom; use the minimap to jump around.
- Keyboard shortcuts: `F` = Fit view, `C` = Center, `R` = Reset layout.

Exporting
- Use the export buttons in the toolbar to save the current view or data as PNG, SVG, JSON (layout + metadata) or CSV.

Troubleshooting
- If a drag-and-drop or IFC import fails, try the file selector or open the demo via a local server (Option B).
- For large IFC files, try smaller samples from `samples/ifc` or pre-convert data into the JSON schema in `json/`.

Option C — GitHub Pages
- To publish the demo online, enable GitHub Pages for this repository and point to the project root or `index.html`.

---

## 🧩 JSON Schema Summary
Each data file contains:

```json
# ONEXUS — Browser Relationship Viewer

ONEXUS is a lightweight, browser-based visualization viewer that reveals relationships between BIM elements, systems, spaces, and organizations. Originally built as a companion viewer for a Revit add-in, the project now exists as a standalone browser tool and a history of snapshots in the `versions/` folder.

**Quick summary:** open `index.html` (root) or one of the example pages in `versions/` to explore the graph UI and sample data.

**What's changed**
- The codebase evolved over multiple snapshots stored in `versions/` (v0.0 → v0.6+).
- Sample data sets moved to the `json/` folder and larger examples are available in `assets/`.

**Quick Start**
- Option A — Open the UI locally: open [index.html](index.html).
- Option B — Run a simple server and browse:
```
npx http-server .
# then open http://localhost:8080
```

**Project Structure (high level)**
- `index.html` — main demo page
- `src/` — app source files (`graph-core.js`, `graph-ui.js`, `onexus-style.js`)
- `json/` — sample/large JSON data files (`onexus_sample.json`, `onexus_doors.json`, ...)
- `assets/` — images and media used by demos
- `versions/` — archived snapshots and historical builds

**Using your own data**
- Drag-and-drop or load any JSON matching the project's simple graph schema (see `json/` examples).

Minimal expected JSON shape:
```
{
  "meta": { "schema": "onexus-1.x", "project": "..." },
  "elements": { "nodes": [...], "edges": [...] }
}
```

Node basics: `id`, `nodeType`, `category`, `label` (multi-language). Edge basics: `id`, `source`, `target`, `type`.

**Development**
- Edit UI/logic in `src/` — see the directory layout in `CLAUDE.md`.
- Open `index.html` or run `npm run serve` to develop with a local server.
- Run `npm run lint` to check for issues; `npm run format` to format code.
- Run `npm run test:smoke` after installing Playwright (`npx playwright install --with-deps chromium`) to verify the app boots correctly.
- For AI-assisted development, see `CLAUDE.md` for project conventions and key APIs.

**Versions & history**
- Historical snapshots are preserved under `versions/`. Use these to compare UI/feature changes or to run older demos.

**Contributing**
- PRs, issue reports, and small fixes are welcome. If you change on-disk behavior, update the README and add a short note under `versions/` or a changelog file.

**License**
- MIT