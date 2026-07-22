/* =========================================================
 ONEXUS Style Engine
 - Themes (light/dark), scale, Cytoscape stylesheet builder
 - Style hooks: setStyleHooks()/clearStyleHooks()
 - Color mode registry: ONEXUS.style.registerColorMode()
 - UI sync: auto inject color modes into #colorModeSelect

 SET E (existing):
 - Formalize ColorMode registry as FIRST-CLASS
 - Add ONEXUS.style.syncColorModeSelect()
 - Provide unified label-policy helpers so SAFE MODE and PERF don't fight

 SET F (this patch):
 - Thumbnail nodes (node.data.img) with minimal impact
 - Image rendering policy + preference toggle
========================================================= */

/* Theme palettes.
 * These feed applyTheme(), which sets --bg-main/--bg-panel/--bg-soft/--stroke/
 * --text-main/--text-muted/--btn-* on :root. Any DOM chrome that must flip
 * between light and dark MUST consume those tokens (e.g. var(--bg-soft)) rather
 * than a hardcoded hex — otherwise it won't re-theme (see #minimap history).
 * Full contract + layout invariants: DESIGN.md. */
const THEMES = {
  light: {
    canvas: "#F5F7FA",
    text: "#111827",
    outline: "#FFFFFF",
    edgeLabelBg: "#FFFFFF",
    edgeLabelText: "#111827",
    ui: {
      page: "#ffffff",
      panel: "#f8f9fb",
      soft: "#f3f4f6",
      stroke: "#e5e7eb",
      muted: "#6b7280",
      icon: "#111827",
      buttonBg: "#ffffff",
      buttonHover: "#eef2ff",
    },
  },
  dark: {
    canvas: "#1E1E1E",
    text: "#FFFFFF",
    outline: "#000000",
    edgeLabelBg: "#2A2A2A",
    edgeLabelText: "#FFFFFF",
    ui: {
      page: "#0F1115",
      panel: "#161A1F",
      soft: "#1A1F26",
      stroke: "#2A2F37",
      muted: "#9AA4B2",
      icon: "#E5E8EB",
      buttonBg: "#1C2229",
      buttonHover: "#2A323C",
    },
  },
};

// current theme state (used by exporters too)
let currentTheme = "light";
window.currentTheme = currentTheme;

// =====================================================
// Layer Style Hooks (foundation)
// =====================================================
window.__onexus_styleHooks = window.__onexus_styleHooks || {
  nodeLabelFn: null,
  edgeLabelFn: null,
  nodeColorFn: null,
  edgeColorFn: null,
};

function setStyleHooks(partial = {}) {
  window.__onexus_styleHooks = window.__onexus_styleHooks || {};
  Object.assign(window.__onexus_styleHooks, partial);

  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);

  window.buildRelationshipLegend?.();
}

function clearStyleHooks() {
  window.__onexus_styleHooks = window.__onexus_styleHooks || {};
  window.__onexus_styleHooks.nodeLabelFn = null;
  window.__onexus_styleHooks.edgeLabelFn = null;
  window.__onexus_styleHooks.nodeColorFn = null;
  window.__onexus_styleHooks.edgeColorFn = null;

  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);

  window.buildRelationshipLegend?.();
}

window.setStyleHooks = setStyleHooks;
window.clearStyleHooks = clearStyleHooks;

// =====================================================
// Scale
// =====================================================
let currentScale = 1.0;
window.__onexus_scale = currentScale;

// =====================================================
// Base category & relationship colors (legacy defaults)
// =====================================================
const CATEGORY_COLORS = {
  Door: "#FF9800",
  SecurityDevice: "#E91E63",
  ControlPanel: "#9C27B0",
  PowerSupply: "#795548",
  Room: "#4CAF50",
  DesignTeam: "#607D8B",
  Subcontractor: "#455A64",
  SecurityVendor: "#6D4C41",
  BuildingSystem: "#607D8B",
  Zone: "#3B82F6",
  PropertySet: "#0EA5E9",
  Port: "#14B8A6",
  Type: "#6366F1",
  Wall: "#9CA3AF",
  DoorLike: "#F59E0B",
};

const RELATIONSHIP_COLORS = {
  Controls: "#FF9800",
  Supplies: "#795548",
  LocatedIn: "#4CAF50",
  DesignedBy: "#3F51B5",
  BuiltBy: "#9C27B0",
  ProvidedBy: "#E91E63",
  PartOfSystem: "#607D8B",
  OfType: "#6366F1",
  HasProperties: "#0EA5E9",
  InZone: "#3B82F6",
  ConnectsTo: "#10B981",
  PortOf: "#14B8A6",
  FillsOpeningIn: "#F59E0B",

  // Semantic relationship vocabulary (IC supply chain, ROD/OneRoot decision graphs).
  // Grouped by what the relationship *means*, not just a unique hue per type:
  // red family = blocking/risk, green family = supports/derives-from,
  // blue/indigo family = structural dependency, amber = governance/ownership.
  blocks: "#EF4444",
  contradicts: "#EF4444",
  creates_risk: "#EF4444",
  rejects: "#F87171",

  depends_on: "#3B82F6",
  requires: "#3B82F6",
  requires_approval_from: "#2563EB",
  supplies: "#0EA5E9",
  delivers_to: "#0EA5E9",
  installed_in: "#06B6D4",
  drives: "#6366F1",

  based_on: "#10B981",
  validates: "#10B981",
  is_evidence_for: "#10B981",
  affects: "#22C55E",
  bounds: "#84CC16",
  enables: "#10B981",

  supersedes: "#F59E0B",
  implements: "#F59E0B",
  reuses: "#F59E0B",
  creates_standard_for: "#D97706",
  owned_by: "#A855F7",
  reviewed_by: "#A855F7",
  requires_approval_from_lc: "#A855F7",
};

// Semantic edge *categories* drive line-style + arrow shape so the relationship
// kind is legible even without color (accessibility, print, colorblind-safe) —
// not just "what color is this edge" but "what shape of relationship is this".
const RELATIONSHIP_LINE_STYLE = {
  blocking: { lineStyle: "dashed", arrow: "tee" },      // blocks/contradicts/rejects/creates_risk
  dependency: { lineStyle: "solid", arrow: "triangle" }, // depends_on/requires/supplies/delivers_to/installed_in/drives
  support: { lineStyle: "dotted", arrow: "circle" },     // based_on/validates/affects/bounds/enables/is_evidence_for
  governance: { lineStyle: "dashed", arrow: "diamond" }, // owned_by/reviewed_by/supersedes/implements/reuses/creates_standard_for
};

const EDGE_TYPE_CATEGORY = {
  blocks: "blocking", contradicts: "blocking", creates_risk: "blocking", rejects: "blocking",
  depends_on: "dependency", requires: "dependency", supplies: "dependency",
  delivers_to: "dependency", installed_in: "dependency", drives: "dependency",
  based_on: "support", validates: "support", is_evidence_for: "support",
  affects: "support", bounds: "support", enables: "support",
  supersedes: "governance", implements: "governance", reuses: "governance",
  creates_standard_for: "governance", owned_by: "governance", reviewed_by: "governance",
  requires_approval_from: "governance",
};

function edgeCategoryFor(type) {
  return EDGE_TYPE_CATEGORY[type] ?? null;
}

const COLOR_PALETTE = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#64748B",
];

function hashString(str) {
  let h = 2166136261;
  str = String(str ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function colorFromKey(key) {
  const idx = hashString(String(key)) % COLOR_PALETTE.length;
  return COLOR_PALETTE[idx];
}

// =====================================================
// ✅ Color Mode Registry (Set E)
// =====================================================
(function () {
  window.ONEXUS = window.ONEXUS || {};
  window.ONEXUS.style = window.ONEXUS.style || {};

  const registry = (window.ONEXUS.style.__colorModes =
    window.ONEXUS.style.__colorModes || new Map());

  function registerColorMode(key, def) {
    const k = String(key ?? "").trim();
    if (!k) throw new Error("registerColorMode: key required");
    const d = def && typeof def === "object" ? def : {};

    registry.set(k, {
      key: k,
      label: d.label ?? k,
      nodeColorFn: (typeof d.nodeColorFn === "function") ? d.nodeColorFn : null,
      edgeColorFn: (typeof d.edgeColorFn === "function") ? d.edgeColorFn : null,
    });

    // auto sync UI when modes change
    try { window.ONEXUS.style.syncColorModeSelect?.(); } catch { /* noop */ }

    return registry.get(k);
  }

  function ensureBuiltinColorModesOnce() {
    if (registry.__builtinsApplied) return;
    registry.__builtinsApplied = true;

    registerColorMode("json_category", {
      label: "JSON / Category",
      nodeColorFn: (ele, ctx) => {
        const d = ele.data?.() || {};
        const explicit = d.color || d.fill || d.bg || d.background;
        if (explicit) return explicit;

        const category = d.category || "";
        const nodeType = d.nodeType || d.type || "";
        return CATEGORY_COLORS[category] ?? colorFromKey(category || nodeType || d.id);
      }
    });

    registerColorMode("nodeType", {
      label: "Node Type",
      nodeColorFn: (ele, ctx) => {
        const d = ele.data?.() || {};
        const nodeType = d.nodeType || d.type || "";
        const category = d.category || "";
        return colorFromKey(nodeType || category || d.id);
      }
    });

    registerColorMode("degree", {
      label: "Degree (Hubs)",
      nodeColorFn: (ele, ctx) => {
        const deg = ele.degree?.(false) ?? 0;
        if (deg <= 1) return "#94A3B8";
        if (deg <= 3) return "#3B82F6";
        if (deg <= 6) return "#F59E0B";
        return "#EF4444";
      }
    });

    registerColorMode("stableRandom", {
      label: "Stable Random",
      nodeColorFn: (ele, ctx) => {
        const d = ele.data?.() || {};
        return colorFromKey(d.id);
      }
    });
  }

  function listColorModes() {
    ensureBuiltinColorModesOnce();
    return Array.from(registry.values());
  }

  function getColorMode(key) {
    ensureBuiltinColorModesOnce();
    return registry.get(String(key ?? "").trim()) || null;
  }

  window.ONEXUS.style.registerColorMode = registerColorMode;
  window.ONEXUS.style.listColorModes = listColorModes;
  window.ONEXUS.style.getColorMode = getColorMode;

  window.ONEXUS.style.syncColorModeSelect = function syncColorModeSelect() {
    ensureBuiltinColorModesOnce();
    const sel = document.getElementById("colorModeSelect");
    if (!sel) return;

    const current = String(sel.value || "").trim();
    const modes = listColorModes();
    const existing = new Set([...sel.options].map(o => o.value));

    for (const m of modes) {
      if (existing.has(m.key)) continue;
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.label ?? m.key;
      sel.appendChild(opt);
    }

    // migration: "level" -> json_category
    if (current === "level") {
      sel.value = "json_category";
      try { localStorage.setItem("onexus.colorMode", "json_category"); } catch { /* noop */ }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(window.ONEXUS.style.syncColorModeSelect, 0));
  } else {
    setTimeout(window.ONEXUS.style.syncColorModeSelect, 0);
  }
})();

// =====================================================
// Label Policy Helpers (Set E)
// =====================================================
window.ONEXUS = window.ONEXUS || {};
window.ONEXUS.style = window.ONEXUS.style || {};

window.ONEXUS.style.shouldShowEdgeLabels = function shouldShowEdgeLabels() {
  if (window.ONEXUS_PERF?.isTempLabelHide?.() === true) return false;
  if (window.ONEXUS_SAFE_MODE?.isEnabled?.() === true) return false;

  const st = window.__onexus_state;
  if (st && typeof st.showEdgeLabels === "boolean") return st.showEdgeLabels;
  return true;
};

window.ONEXUS.style.shouldShowNodeLabels = function shouldShowNodeLabels() {
  if (window.ONEXUS_PERF?.isTempLabelHide?.() === true) return false;

  const st = window.__onexus_state;
  if (st && typeof st.showNodeLabels === "boolean") return st.showNodeLabels;
  return true;
};

// =====================================================
// ✅ Image Node Policy (Set F) — minimal impact
// - Only affects nodes that have data.img
// - Preference: localStorage "onexus.imageNodes.enabled" (default ON)
// - Auto-off when SAFE MODE is enabled (keeps large graphs fast)
// =====================================================
(function () {
  const LS_KEY = "onexus.imageNodes.enabled";

  function readPref() {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === "0") return false;
      if (v === "1") return true;
      return true; // default ON (but no effect unless node has img)
    } catch {
      return true;
    }
  }

  function writePref(v) {
    try { localStorage.setItem(LS_KEY, v ? "1" : "0"); } catch { /* noop */ }
  }

  window.ONEXUS = window.ONEXUS || {};
  window.ONEXUS.style = window.ONEXUS.style || {};

  window.ONEXUS.style.isImageNodesEnabled = function isImageNodesEnabled() {
    return readPref();
  };

  window.ONEXUS.style.setImageNodesEnabled = function setImageNodesEnabled(enabled) {
    writePref(!!enabled);

    // re-apply style
    try {
      const cy = window.cy;
      NEXUS_STYLE = buildStyle(currentTheme);
      if (cy?.style) cy.style(NEXUS_STYLE);
      window.buildRelationshipLegend?.();
      window.showTransientMessage?.(enabled ? "Thumbnails: ON" : "Thumbnails: OFF", 1400);
    } catch { /* noop */ }
  };

  // Central policy used by style functions
  window.ONEXUS.style.shouldRenderNodeImages = function shouldRenderNodeImages() {
    if (!readPref()) return false;
    if (window.ONEXUS_SAFE_MODE?.isEnabled?.() === true) return false;
    // Perf hide is for labels; keep images unless safe mode says otherwise.
    return true;
  };
})();

// =====================================================
// Node label position — inside the node vs. below it
// - Preference: localStorage "onexus.nodeLabelPos"  ("inside" | "outside")
// - "inside" (DEFAULT): label centered on the node (text-valign center) — the
//   original look; compact, keeps the graph dense.
// - "outside": label sits just below the node (text-valign bottom + margin) —
//   never overlaps the node fill; better for long labels / dense hubs.
// Image nodes keep their own imgShowLabel handling and are unaffected.
// =====================================================
(function () {
  const LS_KEY = "onexus.nodeLabelPos";

  function readPref() {
    try {
      return localStorage.getItem(LS_KEY) === "outside" ? "outside" : "inside";
    } catch {
      return "inside";
    }
  }

  function writePref(pos) {
    try { localStorage.setItem(LS_KEY, pos === "outside" ? "outside" : "inside"); }
    catch { /* noop */ }
  }

  window.ONEXUS = window.ONEXUS || {};
  window.ONEXUS.style = window.ONEXUS.style || {};

  // Policy used by buildStyle().
  window.ONEXUS.style.getNodeLabelPosition = function getNodeLabelPosition() {
    return readPref();
  };

  window.ONEXUS.style.setNodeLabelPosition = function setNodeLabelPosition(pos) {
    const norm = pos === "outside" ? "outside" : "inside";
    if (readPref() === norm) return; // no change → skip rebuild + toast
    writePref(norm);
    // re-apply style (same pattern as setImageNodesEnabled)
    try {
      const cy = window.cy;
      NEXUS_STYLE = buildStyle(currentTheme);
      if (cy?.style) cy.style(NEXUS_STYLE);
      window.showTransientMessage?.(
        readPref() === "outside" ? "Labels: below nodes" : "Labels: inside nodes",
        1400
      );
    } catch { /* noop */ }
  };
})();

// =====================================================
// Color mode (active) + applyColorMode()
// =====================================================
let currentColorMode = "json_category";

function nodeColorByMode(ele) {
  const d = ele.data?.() || {};

  // 1) explicit override always wins
  const explicit = d.color || d.fill || d.bg || d.background;
  if (explicit) return explicit;

  // 2) registry mode
  const def = window.ONEXUS?.style?.getColorMode?.(currentColorMode);
  if (def?.nodeColorFn) {
    try {
      const base = CATEGORY_COLORS[d.category] ?? colorFromKey(d.category || d.nodeType || d.id);
      return def.nodeColorFn(ele, { base, mode: currentColorMode }) ?? base;
    } catch {
      // fall through
    }
  }

  // 3) legacy fallback
  const category = d.category || "";
  const nodeType = d.nodeType || d.type || "";
  return CATEGORY_COLORS[category] ?? colorFromKey(category || nodeType || d.id);
}

function edgeColorByType(ele) {
  const t = ele.data?.("type") ?? ele.data?.()?.type ?? "";
  if (!t) return "#999";
  // Curated semantic color wins; otherwise hash to a stable palette color
  // (matches node behavior) so any new/unknown edge type still gets a
  // distinct, consistent color instead of collapsing into flat gray.
  return RELATIONSHIP_COLORS[t] ?? colorFromKey(t);
}

// =====================================================
// Build Cytoscape style
// =====================================================
function buildStyle(themeKey) {
  const T = THEMES[themeKey] ?? THEMES.light;
  const S = Number(window.__onexus_scale ?? currentScale ?? 1.0);

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // √deg scaling: leaf nodes stay small, hubs grow large with clear visual separation.
  // Old linear formula (40 + deg*4) had a 120px cap hit at deg≥20, making all hubs identical.
  // New formula:  18 + √deg × 10  →  deg=0:18px  deg=5:40px  deg=20:63px  deg=100:118px
  // Cap raised to 200px so true hubs (ONES Plugin, Concept nodes) visually dominate.
  const nodeBase = (deg) => 30 + Math.sqrt(Math.max(0, deg)) * 10;
  const nodeSize = (deg) => Math.min(200 * S, nodeBase(deg) * S);

  // Category-aware size cap — overrides degree-based size for low-signal node types
  const nodeSizeForEle = (ele) => {
    const deg = ele.degree ? ele.degree() : 0;
    const cat = ele.data ? (ele.data("category") ?? "") : "";
    const base = nodeSize(deg);
    // Daily notes are time-axis entries, not conceptual hubs — keep them small
    if (cat === "Daily")          return Math.min(base, 28 * S);
    // Project-Detail and Concept-Sub are sub-notes, constrain slightly
    if (cat === "Project-Detail" || cat === "Concept-Sub") return Math.min(base, 55 * S);
    // Navigation MOCs should stand out as landmarks
    if (cat === "Navigation")     return Math.max(base, 48 * S);
    return base;
  };

  const fontNode = `${clamp(9 * S, 6, 16)}px`;
  const fontEdge = `${clamp(9 * S, 7, 16)}px`;

  // Size-proportional labels: the old code used a CONSTANT font + 90px wrap
  // width for every node, so tiny leaves got the same oversized label block as
  // big hubs (labels spilled past the node and collided). Derive both from the
  // node's actual diameter, clamped to stay readable — hubs get a slightly
  // larger, wider label; leaves get a compact one that fits the node.
  const nodeFontFor = (ele) => {
    const d = nodeSizeForEle(ele);
    return `${clamp(d * 0.22, 7, 14)}px`;
  };
  const nodeTextMaxFor = (ele) => {
    const d = nodeSizeForEle(ele);
    return `${clamp(d * 1.9, 80, 170)}px`;
  };

  const textOutlineW = clamp(2 * Math.pow(S, 0.75), 1, 4);
  const textBgPad = `${clamp(3 * S, 2, 8)}px`;

  // Node label position (inside the node by default; below when set to outside).
  const labelOutside = window.ONEXUS?.style?.getNodeLabelPosition?.() === "outside";
  const nodeLabelValign = labelOutside ? "bottom" : "center";
  const nodeLabelMarginY = labelOutside ? clamp(3 * S, 2, 7) : 0;

  const edgeW = clamp(3 * Math.pow(S, 0.9), 1.5, 6);
  const edgeWThin = clamp(2 * Math.pow(S, 0.9), 1, 5);
  const arrowScale = clamp(1 * Math.pow(S, 0.9), 0.7, 1.6);

  const hooks = window.__onexus_styleHooks || {};
  const ctx = { theme: T, scale: S };

  // ---- helpers for image nodes ----
  const imgEnabled = () => window.ONEXUS?.style?.shouldRenderNodeImages?.() !== false;
  const imgFit = (ele) => {
    const v = String(ele.data("imgFit") ?? "cover").toLowerCase();
    return (v === "contain" || v === "cover" || v === "none") ? v : "cover";
  };
  const imgShowLabel = (ele) => ele.data("imgShowLabel") === true;

  return [
    {
      selector: "node",
      style: {
        label: (ele) => {
          if (window.ONEXUS?.style?.shouldShowNodeLabels?.() === false) return "";
          try {
            return hooks.nodeLabelFn ? hooks.nodeLabelFn(ele, ctx) : (ele.data("displayLabel") ?? "");
          } catch {
            return ele.data("displayLabel") ?? "";
          }
        },
        "text-opacity": () => (window.ONEXUS?.style?.shouldShowNodeLabels?.() === false ? 0 : 1),

        "background-color": (ele) => {
          const base = nodeColorByMode(ele);
          try { return hooks.nodeColorFn ? hooks.nodeColorFn(ele, { ...ctx, base }) : base; }
          catch { return base; }
        },

        color: T.text,
        "text-wrap": "wrap",
        "text-max-width": (ele) => nodeTextMaxFor(ele),
        "text-outline-width": textOutlineW,
        "text-outline-color": T.outline,
        "font-size": (ele) => nodeFontFor(ele),
        "font-weight": "bold",
        width:  (ele) => nodeSizeForEle(ele),
        height: (ele) => nodeSizeForEle(ele),
        "text-valign": nodeLabelValign,
        "text-halign": "center",
        "text-margin-y": nodeLabelMarginY,
      },
    },

    // =====================================================
    // ✅ Image nodes (thumbnail) — Set F
    // Only triggers when node has data.img
    // =====================================================
    {
      selector: "node[img]",
      style: {
        // IMPORTANT: background-image uses runtime policy so user can toggle it off
        "background-image": (ele) => {
          if (!imgEnabled()) return "none";
          const u = ele.data("img");
          return u ? String(u) : "none";
        },
        "background-fit": (ele) => imgFit(ele),
        "background-clip": "node",
        "background-opacity": 1,

        // avoid tiling by default
        "background-repeat": (ele) => (String(ele.data("imgRepeat") ?? "no-repeat")),
        "background-position-x": (ele) => (String(ele.data("imgPosX") ?? "50%")),
        "background-position-y": (ele) => (String(ele.data("imgPosY") ?? "50%")),
        "background-width": "100%",
        "background-height": "100%",

        // give image nodes a subtle border so photos stand out on light/dark
        "border-width": clamp(2 * Math.pow(S, 0.9), 1, 4),
        "border-color": (themeKey === "dark") ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.10)",
        "border-opacity": 1,

        // label policy: default off for photo nodes unless imgShowLabel = true
        label: (ele) => {
          if (!imgShowLabel(ele)) return "";
          if (window.ONEXUS?.style?.shouldShowNodeLabels?.() === false) return "";
          return ele.data("displayLabel") ?? "";
        },
        "text-opacity": (ele) => (imgShowLabel(ele) ? 1 : 0),
        "text-valign": (ele) => (imgShowLabel(ele) ? "bottom" : "center"),
        "text-margin-y": (ele) => (imgShowLabel(ele) ? clamp(10 * S, 6, 16) : 0),
        "text-background-opacity": (ele) => (imgShowLabel(ele) ? 0.65 : 0),
        "text-background-color": (themeKey === "dark") ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)",
        "text-background-padding": `${clamp(2.5 * S, 2, 7)}px`,
      },
    },

    // ── Vault / Knowledge graph overrides ─────────────────────────────────────
    // Tag cluster nodes: tiny diamonds — connectors, not content.
    // Their degree inflates their size via the base formula; override it here.
    {
      selector: 'node[nodeType = "Tag"]',
      style: {
        shape: "ellipse",
        width:  clamp(14 * S, 8, 22),
        height: clamp(14 * S, 8, 22),
        "background-opacity": 0.35,
        "border-width": clamp(1.5 * S, 1, 3),
        "border-color": "#94a3b8",
        "border-opacity": 0.6,
        "font-size": `${clamp(7 * S, 5, 10)}px`,
        "text-opacity": 0,
        label: "",
      },
    },
    // Wikilink edges: thinner + semi-transparent to reduce mesh effect
    {
      selector: 'edge[type = "LinksTo"]',
      style: {
        width: clamp(1.0 * Math.pow(S, 0.9), 0.6, 2.0),
        opacity: 0.32,
        "target-arrow-shape": (ele) => (ele.data("directional") ? "triangle" : "none"),
        "arrow-scale": clamp(0.6 * Math.pow(S, 0.9), 0.4, 1.0),
      },
    },
    // Tag edges: almost invisible — they are structural noise in crowded graphs
    {
      selector: 'edge[type = "Tagged"]',
      style: {
        width: clamp(0.7 * Math.pow(S, 0.9), 0.4, 1.2),
        opacity: 0.10,
        "line-style": "dotted",
        "target-arrow-shape": "none",
      },
    },

    // Node type shapes (existing)
    { selector: 'node[nodeType = "System"]', style: { shape: "hexagon", width: 90 * S, height: 90 * S, "border-width": 1, "border-color": T.outline } },
    { selector: 'node[nodeType = "Space"]', style: { shape: "round-rectangle", width: 80 * S, height: 50 * S } },
    { selector: 'node[nodeType = "Organization"]', style: { shape: "rectangle", width: 80 * S, height: 40 * S } },
    { selector: 'node[nodeType = "Vendor"]', style: { shape: "diamond", width: 70 * S, height: 70 * S } },
    { selector: 'node[nodeType = "ComponentType"]', style: { shape: "round-rectangle", width: 80 * S, height: 36 * S, "border-width": 1, "border-color": THEMES[currentTheme]?.text ?? "#111" } },
    { selector: 'node[nodeType = "PropertySet"]', style: { shape: "rectangle", width: 90 * S, height: 36 * S, "background-opacity": 0.9, "border-width": 1, "border-color": THEMES[currentTheme]?.text ?? "#111" } },
    { selector: 'node[nodeType = "Port"]', style: { shape: "vee", width: 46 * S, height: 46 * S, "border-width": 1, "border-color": THEMES[currentTheme]?.text ?? "#111" } },

    { selector: "node.linkTarget", style: { "border-width": 4, "border-color": "#a855f7" } },

    {
      selector: "edge",
      style: {
        label: (ele) => {
          if (window.ONEXUS?.style?.shouldShowEdgeLabels?.() === false) return "";
          try {
            return hooks.edgeLabelFn ? hooks.edgeLabelFn(ele, ctx) : (ele.data("displayType") ?? ele.data("type") ?? "");
          } catch {
            return ele.data("displayType") ?? ele.data("type") ?? "";
          }
        },
        "text-opacity": () => (window.ONEXUS?.style?.shouldShowEdgeLabels?.() === false ? 0 : 1),

        "line-color": (ele) => {
          const base = edgeColorByType(ele);
          try { return hooks.edgeColorFn ? hooks.edgeColorFn(ele, { ...ctx, base }) : base; }
          catch { return base; }
        },
        "target-arrow-color": (ele) => {
          const base = edgeColorByType(ele);
          try { return hooks.edgeColorFn ? hooks.edgeColorFn(ele, { ...ctx, base }) : base; }
          catch { return base; }
        },

        "target-arrow-shape": (ele) => {
          if (!ele.data("directional")) return "none";
          const cat = edgeCategoryFor(ele.data("type"));
          return cat ? RELATIONSHIP_LINE_STYLE[cat].arrow : "triangle";
        },
        "line-style": (ele) => {
          const cat = edgeCategoryFor(ele.data("type"));
          return cat ? RELATIONSHIP_LINE_STYLE[cat].lineStyle : "solid";
        },
        "arrow-scale": arrowScale,
        "curve-style": "bezier",
        width: edgeW,

        color: T.edgeLabelText,
        "text-background-color": T.edgeLabelBg,
        "text-background-opacity": 0.9,
        "text-background-padding": textBgPad,
        "font-size": fontEdge,
        "text-rotation": "autorotate",
      },
    },

    // SAFE MODE (large graphs): simplified edge rendering
    {
      selector: "edge.onx-safe",
      style: {
        "curve-style": "haystack",
        "text-opacity": 0,
        label: "",
        width: clamp(1.8 * Math.pow(S, 0.9), 1, 4),
        opacity: 0.75,
        "target-arrow-shape": (ele) => (ele.data("directional") ? "triangle" : "none"),
        "arrow-scale": clamp(0.9 * Math.pow(S, 0.9), 0.6, 1.3),
      },
    },

    // Relationship styles (existing)
    { selector: 'edge[type = "PartOfSystem"]', style: { "line-style": "dotted", width: edgeWThin, opacity: 0.8 } },
    { selector: 'edge[confidence = "Inferred"]', style: { "line-style": "dashed", opacity: 0.6 } },
    { selector: 'edge[type = "OfType"]', style: { "line-style": "dashed", width: edgeWThin } },
    { selector: 'edge[type = "HasProperties"]', style: { "line-style": "dotted", width: edgeWThin } },
    { selector: 'edge[type = "InZone"]', style: { "line-style": "solid", width: edgeWThin } },
    { selector: 'edge[type = "ConnectsTo"]', style: { "curve-style": "straight", width: edgeWThin } },
    { selector: 'edge[type = "PortOf"]', style: { "line-style": "solid", width: edgeWThin } },
    { selector: 'edge[type = "FillsOpeningIn"]', style: { "line-style": "solid", width: clamp(3 * Math.pow(S, 0.9), 2, 6) } },

    // selection & highlights (existing)
    { selector: "node:selected", style: { "border-width": clamp(5 * Math.pow(S, 0.85), 3, 8), "border-color": "#22c55e", "border-opacity": 0.95, "background-opacity": 1 } },
    { selector: "edge:selected", style: { "line-color": "#22c55e", "target-arrow-color": "#22c55e", width: clamp(6 * Math.pow(S, 0.9), 3, 10), opacity: 0.95 } },
    { selector: ".faded", style: { opacity: 0.15, "text-opacity": 0.1 } },
    { selector: ".highlight", style: { "border-width": 4, "border-color": "#2563eb", "background-opacity": 0.95 } },
    { selector: "node.path", style: { "border-width": 4, "border-color": "#2563eb", "background-opacity": 0.98 } },
    { selector: "edge.path", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },
    { selector: "edge.path.upstream", style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
    { selector: "edge.path.downstream", style: { "line-color": "#10b981", "target-arrow-color": "#10b981" } },

    // LOD (existing)
    { selector: ".lod-low", style: { "text-opacity": 0 } },
    { selector: "edge.lod-low", style: { label: "", "curve-style": "haystack", "target-arrow-shape": "none" } },
    { selector: "node.lod-low", style: { label: "", "text-opacity": 0 } },
    { selector: "node.lod-mid", style: { label: "data(displayLabel)", "text-opacity": 1 } },
    { selector: "edge.lod-mid", style: { label: "", "curve-style": "straight", "target-arrow-shape": "none" } },
    {
      selector: "edge.lod-high",
      style: {
        label: "data(displayType)",
        "curve-style": "bezier",
        "target-arrow-shape": (ele) => {
          if (!ele.data("directional")) return "none";
          const cat = edgeCategoryFor(ele.data("type"));
          return cat ? RELATIONSHIP_LINE_STYLE[cat].arrow : "triangle";
        },
      },
    },

    // Tree nested (existing)
    { selector: "edge.nestEdge", style: { "line-color": "#607D8B", width: clamp(4 * Math.pow(S, 0.9), 2, 7) } },
    { selector: "edge.nonNestEdge", style: { opacity: 0.25 } },

    // compare (existing)
    { selector: "node.diff-added", style: { "border-width": 4, "border-color": "#10b981" } },
    { selector: "node.diff-removed", style: { "border-width": 4, "border-color": "#ef4444", opacity: 0.65 } },
    { selector: "node.diff-changed", style: { "border-width": 4, "border-color": "#f59e0b" } },
    { selector: "edge.diff-added", style: { "line-color": "#10b981", "target-arrow-color": "#10b981", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },
    { selector: "edge.diff-removed", style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", "line-style": "dashed", width: clamp(4 * Math.pow(S, 0.9), 2, 7), opacity: 0.7 } },
    { selector: "edge.diff-changed", style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    // risk/option (existing)
    { selector: "edge.conf-inferred", style: { "line-style": "dashed", opacity: 0.65 } },
    { selector: "edge.layer-risk", style: { "text-opacity": 1 } },
    { selector: 'node[layer-option][nodeType = "Option"]', style: { "border-width": 4, "border-color": "#6366f1" } },
    { selector: 'edge[layer-option][type = "Optimizes"]', style: { width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    // Visibility toggles (class-based) (existing)
    { selector: ".layer-hide", style: { display: "none" } },
    { selector: ".onx-hide-filter", style: { display: "none" } },
    { selector: ".onx-hide-end", style: { display: "none" } },
    { selector: ".onx-hide-compare", style: { display: "none" } },
    { selector: ".onx-hide-reveal", style: { display: "none" } },
    { selector: ".onx-hide-node-vis", style: { display: "none" } },
    { selector: ".onx-hide-isolated", style: { display: "none" } },

    // Perf: hide labels during load/layout (temp class) (existing)
    { selector: "node.onx-hide-labels-temp", style: { "text-opacity": 0, label: "" } },
    { selector: "edge.onx-hide-labels-temp", style: { "text-opacity": 0, label: "" } },
  ];
}

// Global style instance
let NEXUS_STYLE = buildStyle(currentTheme);
window.NEXUS_STYLE = NEXUS_STYLE;
window.THEMES = THEMES;

// apply size scale without relayout
function applyScale(scale) {
  currentScale = Math.max(0.5, Math.min(2.0, Number(scale ?? 1.0)));
  window.__onexus_scale = currentScale;

  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);

  window.buildRelationshipLegend?.();
}

function applyColorMode(mode) {
  // ensure built-ins registered
  window.ONEXUS?.style?.listColorModes?.();

  currentColorMode = String(mode ?? "json_category").trim() || "json_category";

  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);

  window.buildRelationshipLegend?.();
  try {
    window.ONEXUS?.style?.syncColorModeSelect?.();
    // Sync the dropdown's selected value to match the active mode.
    // syncColorModeSelect adds the option if missing but never selects it.
    const sel = document.getElementById("colorModeSelect");
    if (sel && sel.value !== currentColorMode) sel.value = currentColorMode;
  } catch { /* noop */ }
}

function applyTheme(themeKey) {
  currentTheme = (themeKey === "dark") ? "dark" : "light";
  window.currentTheme = currentTheme;

  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(currentTheme === "dark" ? "theme-dark" : "theme-light");

  const ui = THEMES[currentTheme].ui;
  if (ui) {
    const cssProps = {
      "--bg-main": ui.page,
      "--bg-panel": ui.panel,
      "--bg-soft": ui.soft,
      "--stroke": ui.stroke,
      "--text-main": currentTheme === "dark" ? "#E6E9EE" : "#111827",
      "--text-muted": ui.muted,
      "--icon-color": ui.icon,
      "--btn-bg": ui.buttonBg,
      "--btn-bg-hover": ui.buttonHover,
      "--bg-canvas": THEMES[currentTheme].canvas,
    };
    Object.entries(cssProps).forEach(([k, v]) => root.style.setProperty(k, v));
  }

  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.container) {
    cy.container().style.backgroundColor = THEMES[currentTheme].canvas;
    cy.style(NEXUS_STYLE);
  }

  window.buildRelationshipLegend?.();
}

function getCurrentThemeKey() { return currentTheme; }
function getCurrentScale() { return currentScale; }

window.applyColorMode = applyColorMode;
window.currentColorMode = () => currentColorMode;
window.applyTheme = applyTheme;
window.applyScale = applyScale;
window.getCurrentThemeKey = getCurrentThemeKey;

// Graph fade-in: replay the enter animation whenever a graph finishes loading
try {
  window.ONEXUS?.bus?.on?.("graphLoaded", () => {
    const el = document.getElementById("cy");
    if (!el) return;
    el.classList.remove("onx-graph-enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("onx-graph-enter");
  });
} catch { /* optional motion */ }
window.getCurrentScale = getCurrentScale;