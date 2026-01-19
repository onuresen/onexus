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
/README.md
/index.html
/src/
   graph-core.js
   graph-ui.js
   onexus-style.js
/onexus_sample.json
/assets/
   banner.png (optional)
```

---

## 📦 Installation & Usage
No installation required.

### Option A — Open Locally
Simply open:
```
index.html
```

### Option B — Local Web Server
```
npx http-server .
```
Then open:
```
http://localhost:8080
```

### Option C — GitHub Pages
Enable GitHub Pages → Done.

---

## 🧩 JSON Schema Summary
Each data file contains:

```json
{
  "meta": {
    "schema": "onexus-1.1",
    "project": "Sample Access Control System",
    "languageDefault": "en",
    "phases": ["Sekkei", "SeisanSekkei", "Kouji"]
  },
  "elements": {
    "nodes": [...],
    "edges": [...]
  }
}
```

### Nodes
- `id`
- `nodeType` (System / Element / Space / Organization / Vendor)
- `category`
- `label` (with `en` and `jp`)
- Optional: `level`, `revitCategory`

### Edges
- `id`, `type`, `dimension`
- `source`, `target`
- `directional`
- Optional: `phase[]`, `owner`, `risk`, `notes`

---

## 🧪 Sample JSON (included)
See full file: `onexus_sample.json`

```json
{
  "id": "E-FR-001",
  "nodeType": "Element",
  "category": "SecurityDevice",
  "label": { "en": "Face Recognition", "jp": "顔認証装置" }
}
```

---

## 🖼️ Screenshots
(Replace with actual images)
```
![System Layout](assets/system_layout.png)
![Spatial Lens](assets/spatial.png)
![Legend + Details](assets/details.png)
```

---

## 🔧 Developer Notes
- Graph logic in `graph-core.js`
- UI bindings in `graph-ui.js`
- Theme engine in `onexus-style.js`
- Navigation uses Cytoscape Navigator plugin
- LOD driven by zoom tier thresholds

---

## 🗺️ Roadmap
### Phase 1 — Relationship Layer (Current)
- Graph
- Filters & Lenses
- Export tools

### Phase 2 — Authoring Assist
- Manual editing of relationships

### Phase 3 — Revit Integration
- Round-trip element selection
- Non-destructive parameter hints

### Phase 4 — Additional Layers
- Intent Layer
- Lifecycle Layer
- Risk Layer

---

## 🤝 Contributing
Pull requests welcome.

---

## 📜 License
MIT License.

---

## 🙏 Acknowledgements
Built for clarity in BIM communication.

---