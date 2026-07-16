# Design: Downloadable JSON Schema for AI-Assisted Data Conversion

**Date:** 2026-07-16
**Status:** Approved

## Problem

Beginners who want to bring their own data into ONEXUS have no self-contained
reference for the expected JSON shape. The closest thing today is the "JSON
Schema" section in `README.md` (a single annotated example), which is fine for
a human skimming docs but isn't something a user can hand directly to an AI
assistant and say "convert my data to match this."

## Goal

Add a real, downloadable JSON Schema document describing the ONEXUS graph
format, plus a toolbar button so any user — especially non-technical
beginners — can grab it in one click and upload it to an AI of their choice to
convert their own data into ONEXUS-compatible JSON.

## Non-goals

- Runtime validation of imports against this schema (the existing
  `validateOnexusJson()` in `graph-core.io.host.js` already does hand-rolled
  validation; this schema is a reference artifact, not a new validation path).
- A bundled example file or written guide alongside the schema — the schema's
  own `examples` keyword carries a full worked instance, so one file is
  self-contained.
- Changing what fields the app accepts or requires.

## Design

### 1. Schema file — `schemas/onexus-graph.schema.json`

A JSON Schema (draft 2020-12) grounded in the actual validation logic in
`src/core/graph-core.io.host.js` (`validateOnexusJson`), not aspirational
fields. Key points, cross-checked against the code:

- **Root**: only `elements` is required (the loader never requires `meta`).
  `meta` is documented as recommended, with `schema`, `project`, `timestamp`,
  `phases`, `languageDefault` as its common sub-fields.
- **Node** (`elements.nodes[].data`): required `id`, `nodeType`, `label`.
  `category` OR `revitCategory` is required (either satisfies it — matches
  the real `anyOf` check at `graph-core.io.host.js:103`).
- **Edge** (`elements.edges[].data`): required `id`, `type`, `dimension`,
  `source`, `target`, `directional` (boolean, per the strict boolean check at
  line 116).
- **`label`**: `{ en: string, jp?: string }`. Documented as the only two
  languages actually persisted end-to-end — `ensureLabelObject()` drops any
  other language key, and the UI's `tr` option in `#languageSelect` has no
  backing translation table, so the schema will not imply `tr` is supported.
- **`risk`** (edge): documented via `enum: ["High", "Medium", "Low"]` as the
  clean canonical form, with a description noting the app's `parseRisk()`
  also accepts lowercase / `h`/`m`/`l` / `1`-`3` / a raw 0-1 number, but High/
  Medium/Low is what we recommend an AI generate.
- **`confidence`** (edge): `enum: ["Explicit", "Inferred"]`, with a
  description noting only `"Inferred"` (case-insensitive) changes rendering
  (dashed edge, `conf-inferred` class); any other non-empty value renders
  identically to `"Explicit"`.
- **`dimension`, `nodeType`, `category`**: left as open `type: "string"`
  fields (they're genuinely free-vocabulary — `dimension` is filtered by
  exact string match with no whitelist, `category` normalizes but doesn't
  restrict). Descriptions list the values that get special treatment in code
  so an AI can choose meaningfully:
  - `nodeType`: System, Space, Organization, Vendor, ComponentType,
    PropertySet, Port, Option, Tag get distinct icons/styling; anything else
    (including missing) becomes `"Component"`.
  - `dimension`: System, Spatial, Responsibility, Vendor are the built-in
    starter suggestions shown in the UI's dimension picker; any other string
    works and just becomes a new legend entry.
- **`additionalProperties: true`** at every object level — CLAUDE.md is
  explicit that extra fields are preserved and may be used by plugins; the
  schema must not contradict that by locking the shape down.
- **`examples`**: one full worked instance (a small 2-node, 1-edge graph)
  embedded directly in the schema document via the JSON Schema `examples`
  keyword, so an AI reading the file sees both the contract and a concrete
  instance without needing a second file.

### 2. Toolbar button

A new `icon-btn` added to `index.html`, inside the existing `.iconbar` div,
placed directly after the Obsidian import button (end of the "Import" button
group). Being inside `.iconbar` means `graph-ui.mobile.toolbar.js` picks it up
automatically and clones it into the mobile "More" menu — no mobile-specific
work needed.

- `id="btnSchema"`, `title="Download JSON Schema"`,
  `aria-label="Download JSON Schema"`.
- Icon: a document outline with a download arrow (stroke-based SVG,
  `viewBox="0 0 24 24"`, matching the existing icon style — 1.6 stroke width,
  round caps/joins).
- `onclick="downloadSchema()"`.

### 3. `downloadSchema()` function

Added to `src/core/graph-core.io.export.js` alongside the existing
`exportPNG`/`exportSVG`/`exportJSON`/`exportCSV`/`exportLayout` functions,
reusing the file's existing `download(filename, dataUrlOrBlob)` helper.

```js
function downloadSchema() {
  download("onexus-graph.schema.json", "schemas/onexus-graph.schema.json");
  try {
    window.showTransientMessage?.(
      "Schema downloaded — upload it to any AI and ask it to convert your data to match it.",
      2600
    );
  } catch {}
}
```

Exposed as `window.downloadSchema = downloadSchema;` alongside the other
export globals. The existing `download()` helper already branches on string
vs. Blob (treats a string as a direct `href`), so pointing it at the static
same-origin file path works without a fetch/Blob round-trip.

### Error handling

None needed beyond the existing `try { } catch { }` around the toast — the
schema file is a static asset shipped with the app, not user input; there's
no failure mode to design for beyond "the browser couldn't trigger a
download," which is outside the app's control.

### Testing

No new Playwright test. Per this repo's test philosophy (few, high-signal,
no soft-skips), a static-file-download-triggered-by-click isn't a case likely
to regress silently, and existing smoke tests already assert zero console
errors on boot — adding the button/script doesn't change that surface.
Manual verification: click the button, confirm the file downloads with valid
JSON Schema content, confirm the toast appears, confirm the button/icon
appears correctly in both desktop toolbar and mobile "More" menu.
