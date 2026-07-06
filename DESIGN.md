# ONEXUS — Design System

The design source of truth for the ONEXUS graph viewer. Use this to calibrate any
visual change; deviations from what's here are regressions, not preferences.

ONEXUS is an **App UI** (a graph workspace), not a marketing page. Judge it by the
App-UI bar: calm surface hierarchy, strong typography, few colors, minimal chrome,
data dense but readable. Landing-page moves (hero blocks, decorative gradients,
3-up feature grids, icons-in-circles) do not belong here.

## Where the theme lives

ONEXUS's theme is split between an **upstream shared system** (synced in, don't edit
locally) and **ONEXUS-native code** (owns runtime theming + dark mode).

### Upstream — the shared UI system (do NOT edit the local copies)

Canonical home: `Vibe_Coding/ui-system/`. A `sync.ps1` copies these into ONEXUS's
`src/common/` per `targets.json` (ONEXUS is an onboarded Tier-A target,
`palette: layer-semantic`). **Edit upstream, bump `ui-system/VERSION`, re-sync —
never touch the local copies, they get overwritten.**

| Local copy | Upstream source | What it is |
|------------|-----------------|-----------|
| `src/common/ui-base.css` | `ui-system/ui-base.css` | Shared primitives (`.btn/.card/.input/.ui-modal`) + `--z-*` scale on the `--surface`/`--text`/`--accent` contract. Consumed by 7 tools. |
| `src/common/layer-semantic.css` | `ui-system/palettes/layer-semantic.css` | **ONEXUS's palette of record.** Maps the shared contract to ONEXUS colours (`--surface`, `--text`, `--accent` = layer-semantic). **Light only — the "blueprint" palette carries no dark values.** |

### ONEXUS-native — runtime theming, dark mode, graph chrome

| Concern | File | Notes |
|---------|------|-------|
| Palette engine (light **+ dark**) | `src/helpers/onexus-style.js` → `THEMES` + `applyTheme()` | JS sets `--bg-*`, `--stroke`, `--text-*`, `--btn-*` on `:root` per theme. **This is the only place dark mode exists.** Edit runtime palette values here. |
| Light defaults + non-palette tokens | `src/common/onexus-common.css` `:root` | Radius, fonts, layer accents, grid, shadows. Light values double as the CSS fallback. |
| Layer-semantic accent | `onexus-common.css` (+ upstream `layer-semantic.css`) | `data-onx-layer` on `<html>` drives `--onx-layer-accent`; `--accent` aliases it. |
| Layout / corner overlays | `src/layouts/layout-*.css` | Not synced, ONEXUS-only. |

### The divergence (why the minimap dark bug was possible)

Two token contracts coexist: the upstream palette (`--surface`, `--text`, light
only) and the ONEXUS-native set (`--bg-main`, `--bg-soft`, `--text-main`,
`--stroke`, **light + dark**). The graph chrome runs on the native set, so **dark
mode lives only in `onexus-style.js`, not in the shared palette.** Style graph
chrome with the native tokens; anything that must flip light↔dark has to reference
a native token (e.g. `var(--bg-soft)`), because the shared palette can't theme it.
Don't cross the two contracts.

## Typography

Loaded via Google Fonts `<link>` in `index.html`. Never fall back to Inter /
system-ui as the primary face — that's the "gave up on typography" signal.

| Token | Face | Use |
|-------|------|-----|
| `--font-display` | **Archivo** | Titles, section headers (`h3`), badges, panel titles, the ONEXUS wordmark |
| `--font-body` | **IBM Plex Sans** | All body copy, controls, labels |
| `--font-mono` | **IBM Plex Mono** | Data only: counts, IDs, metric values. Always with `font-variant-numeric: tabular-nums` so columns align |

Panel headers (`h3`, `.ui-section-title`): 11–12px, weight 600–700, uppercase,
`letter-spacing` ~0.04–0.05em, colored `--text-muted`. Section titles are labels,
not content — keep them quiet.

## Color tokens

Palette flips between themes via `applyTheme()`. **Never hardcode a hex for chrome
that should re-theme — always reference the token.** (See Layout invariants.)

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--bg-main` | `#ffffff` | `#0F1115` | Page background |
| `--bg-panel` | `#f8f9fb` | `#161A1F` | Toolbar / primary panel surface |
| `--bg-soft` | `#f3f4f6` | `#1A1F26` | Slightly elevated card / overlay surface |
| `--bg-canvas` | `#f5f7fa` | `#1E1E1E` | Cytoscape canvas |
| `--text-main` | `#111827` | `#E6E9EE` | Primary text (dark text is off-white, never pure `#fff`) |
| `--text-muted` | `#6b7280` | `#9AA4B2` | Secondary / labels / hints only |
| `--stroke` | `#e5e7eb` | `#2A2F37` | Borders and dividers |
| `--btn-bg` / `--btn-bg-hover` | `#ffffff` / `#eef2ff` | `#1C2229` / `#2A323C` | Button surfaces |
| `--icon-color` | `#111827` | `#E5E8EB` | Toolbar icons |

### Layer-semantic accent

Each layer mode signs the whole UI. `setLayerMode()` sets `data-onx-layer` on
`<html>`; `--onx-layer-accent` re-tints and `--accent` aliases it. Use
`var(--accent)` for focus rings, active states, and highlights so chrome retints
with the active layer — **never** substitute a fixed brand color for the accent.

| Layer | Accent | Hue |
|-------|--------|-----|
| `relationship` | `#2563eb` | blue |
| `lifecycle` | `#0d9488` | teal |
| `risk` | `#e0a423` | amber |
| `option` | `#7c3aed` | violet |

The body carries two faint accent-tinted corner washes and the canvas a
theme-aware dot grid (`--grid-dot`, `--grid-size: 26px`) + vignette — atmosphere,
not decoration. Don't add more.

## Radius, spacing, elevation, motion

- **Radius:** `--r-sm 7px` · `--r-md 10px` (= `--radius`) · `--r-lg 14px` · `--r-pill 999px`. Nested radius = outer − gap; don't slap one bubbly radius on everything.
- **Spacing:** `--gap: 12px` base. Related items closer, sections further apart.
- **Elevation:** `--shadow-sm 0 1px 3px rgba(0,0,0,.05)` for cards, `--shadow-md 0 4px 12px rgba(0,0,0,.08)` for popovers/modals.
- **Motion:** ease `cubic-bezier(0.22, 1, 0.36, 1)`; 120–220ms; animate only `transform`/`opacity`; honor `prefers-reduced-motion`. No `transition: all`.

## Graph node / label / layout scaling

Size-proportional and self-balancing — do not hardcode constant font/wrap sizes
(see CLAUDE.md → "Graph node / label / layout scaling"). Tuning knobs are the four
multipliers `0.22`, `1.9`, `0.9`, `450` in `src/helpers/onexus-style.js`. Labels
sit **below** nodes so the node is never hidden behind its text.

## Layout invariants

Rules that were violated and fixed — keep them true.

### Corner overlays share the canvas edges; they must never collide

The canvas has floating overlays anchored to its corners inside `#canvas-wrap`:

| Overlay | Anchor | z-index |
|---------|--------|---------|
| `#legendOverlay` (category legend) | top-right, grows **down** with one row per relationship type | 22 |
| `#metricsOverlay` (Graph stats + Filters) | bottom-right, above the minimap (`bottom: calc(12px + 150px + 8px)`) | 12 |
| `#minimap` | bottom-right corner (`bottom: 12px`) | 10 |

The legend length is data-driven (13+ categories on rich graphs). On short
viewports it used to grow into the metrics panel and render on top of it —
unreadable. **Contract:** the legend is boxed between its top offset and the
metrics zone (`#legendOverlay { bottom: 315px }` on desktop, `min-width: 821px`)
and the list scrolls (`#legend { overflow-y: auto; min-height: 0 }`). If you add
or move a bottom-right overlay, re-check that legend → metrics → minimap still
stack with ≥12px gaps at 1280×720. Mobile collapses the legend to a chip and hides
metrics, so the desktop cap is media-scoped and doesn't touch mobile.

### Overlays re-theme; no hardcoded colors on themed chrome

Any surface that should follow light/dark must use a palette token, not a literal.
`#minimap` shipped `background: #ffffff` and became a glaring white box in dark
mode; it's now `var(--bg-soft)`. Before hardcoding a color on a panel, card,
overlay, or border, ask whether it should flip with the theme — if yes, use the
token.

## Do / Don't

**Do**
- Reference tokens (`var(--bg-soft)`, `var(--accent)`, `var(--stroke)`) for all chrome.
- Keep the legend/metrics/minimap corner stack non-overlapping at ≤720px tall.
- Use `--font-mono` + `tabular-nums` for every count and metric value.
- Let the active layer tint focus/active states via `var(--accent)`.

**Don't**
- Hardcode `#ffffff` / `#000` / a brand hex on themed chrome.
- Add decorative gradients, blobs, icon-in-circle rows, or a fixed accent that
  ignores the layer mode.
- Let a data-driven panel grow unbounded into a neighbor — cap and scroll.
- Switch the primary face to Inter/system-ui.

---
*Baseline established 2026-07-06 during a `/design-review` pass (fixed the
legend/metrics collision and the dark-mode minimap). Update this file when the
palette, tokens, or corner-overlay layout changes.*
