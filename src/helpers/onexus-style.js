/* =========================================================
 ONEXUS Style Engine
 - Themes (light/dark), scale, Cytoscape stylesheet builder
 - Style hooks: setStyleHooks()/clearStyleHooks()
 - Color mode registry: ONEXUS.style.registerColorMode()
 - UI sync: auto inject color modes into #colorModeSelect

 SET E PATCH:
 - Formalize ColorMode registry as FIRST-CLASS (no plugin monkey-patching needed)
 - Add ONEXUS.style.syncColorModeSelect() and auto-run on registration
 - Provide unified label-policy helpers so SAFE MODE and PERF don't fight
========================================================= */

/* Theme palettes */
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
};

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
// - Plugins can register: { label, nodeColorFn?, edgeColorFn? }
// - applyColorMode() routes through registry (no plugin patching needed)
// =====================================================
(function () {
  window.ONEXUS = window.ONEXUS || {};
  window.ONEXUS.style = window.ONEXUS.style || {};

  const registry = (window.ONEXUS.style.__colorModes = window.ONEXUS.style.__colorModes || new Map());

  function ensureBuiltinColorModesOnce() {
    if (registry.__builtinsApplied) return;
    registry.__builtinsApplied = true;

    // Built-ins that map to existing legacy behavior:
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

    // Auto sync UI when modes change
    try { window.ONEXUS.style.syncColorModeSelect?.(); } catch { }
    return registry.get(k);
  }

  function listColorModes() {
    ensureBuiltinColorModesOnce();
    return Array.from(registry.values());
  }

  function getColorMode(key) {
    ensureBuiltinColorModesOnce();
    return registry.get(String(key ?? "").trim()) || null;
  }

  // Expose
  window.ONEXUS.style.registerColorMode = registerColorMode;
  window.ONEXUS.style.listColorModes = listColorModes;
  window.ONEXUS.style.getColorMode = getColorMode;

  // UI sync helper (dropdown options)
  window.ONEXUS.style.syncColorModeSelect = function syncColorModeSelect() {
    ensureBuiltinColorModesOnce();
    const sel = document.getElementById("colorModeSelect");
    if (!sel) return;

    const current = String(sel.value || "").trim();
    const modes = listColorModes();

    // Build a stable set of existing values
    const existing = new Set([...sel.options].map(o => o.value));

    // Add missing options
    for (const m of modes) {
      if (existing.has(m.key)) continue;
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.label ?? m.key;
      sel.appendChild(opt);
    }

    // If current value was "level" (old), map to json_category
    if (current === "level") {
      sel.value = "json_category";
      try { localStorage.setItem("onexus.colorMode", "json_category"); } catch { }
    }
  };

  // Boot UI sync
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(window.ONEXUS.style.syncColorModeSelect, 0));
  } else {
    setTimeout(window.ONEXUS.style.syncColorModeSelect, 0);
  }
})();

// =====================================================
// Label Policy Helpers (Set E)
// - Safe Mode wants edge labels OFF by default.
// - Perf mode may temporarily force both labels off.
// - These helpers keep behavior consistent.
// =====================================================
window.ONEXUS = window.ONEXUS || {};
window.ONEXUS.style = window.ONEXUS.style || {};

window.ONEXUS.style.shouldShowEdgeLabels = function shouldShowEdgeLabels() {
  // If perf temp hide is active, ALWAYS hide.
  if (window.ONEXUS_PERF?.isTempLabelHide?.() === true) return false;
  // If safe mode enabled, prefer hidden edge labels.
  if (window.ONEXUS_SAFE_MODE?.isEnabled?.() === true) return false;
  // Otherwise use core state if available.
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

  // 3) legacy fallback (json_category-like)
  const category = d.category || "";
  const nodeType = d.nodeType || d.type || "";
  return CATEGORY_COLORS[category] ?? colorFromKey(category || nodeType || d.id);
}

function edgeColorByType(ele) {
  const t = ele.data?.("type") ?? ele.data?.()?.type ?? "";
  return RELATIONSHIP_COLORS[t] ?? "#999";
}

function buildStyle(themeKey) {
  const T = THEMES[themeKey] ?? THEMES.light;
  const S = Number(window.__onexus_scale ?? currentScale ?? 1.0);

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const nodeBase = (deg) => 40 + deg * 4;
  const nodeSize = (deg) => Math.min(120 * S, nodeBase(deg) * S);

  const fontNode = `${clamp(10 * S, 7, 18)}px`;
  const fontEdge = `${clamp(9 * S, 7, 16)}px`;

  const textOutlineW = clamp(2 * Math.pow(S, 0.75), 1, 4);
  const textBgPad = `${clamp(3 * S, 2, 8)}px`;

  const edgeW = clamp(3 * Math.pow(S, 0.9), 1.5, 6);
  const edgeWThin = clamp(2 * Math.pow(S, 0.9), 1, 5);
  const arrowScale = clamp(1 * Math.pow(S, 0.9), 0.7, 1.6);

  const hooks = window.__onexus_styleHooks || {};
  const ctx = { theme: T, scale: S };

  return [
    {
      selector: "node",
      style: {
        label: (ele) => {
          if (window.ONEXUS?.style?.shouldShowNodeLabels?.() === false) return "";
          try { return hooks.nodeLabelFn ? hooks.nodeLabelFn(ele, ctx) : (ele.data("displayLabel") ?? ""); }
          catch { return ele.data("displayLabel") ?? ""; }
        },
        "text-opacity": () => (window.ONEXUS?.style?.shouldShowNodeLabels?.() === false ? 0 : 1),
        "background-color": (ele) => {
          const base = nodeColorByMode(ele);
          try { return hooks.nodeColorFn ? hooks.nodeColorFn(ele, { ...ctx, base }) : base; }
          catch { return base; }
        },
        color: T.text,
        "text-wrap": "wrap",
        "text-max-width": `${clamp(90 * S, 60, 160)}px`,
        "text-outline-width": textOutlineW,
        "text-outline-color": T.outline,
        "font-size": fontNode,
        "font-weight": "bold",
        width: (ele) => nodeSize(ele.degree()),
        height: (ele) => nodeSize(ele.degree()),
        "text-valign": "center",
        "text-halign": "center",
      },
    },

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
          try { return hooks.edgeLabelFn ? hooks.edgeLabelFn(ele, ctx) : (ele.data("displayType") ?? ele.data("type") ?? ""); }
          catch { return ele.data("displayType") ?? ele.data("type") ?? ""; }
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

        "target-arrow-shape": (ele) => (ele.data("directional") ? "triangle" : "none"),
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
        "arrow-scale": clamp(0.9 * Math.pow(S, 0.9), 0.6, 1.3)
      }
    },

    { selector: 'edge[type = "PartOfSystem"]', style: { "line-style": "dotted", width: edgeWThin, opacity: 0.8 } },
    { selector: 'edge[confidence = "Inferred"]', style: { "line-style": "dashed", opacity: 0.6 } },
    { selector: 'edge[type = "OfType"]', style: { "line-style": "dashed", width: edgeWThin } },
    { selector: 'edge[type = "HasProperties"]', style: { "line-style": "dotted", width: edgeWThin } },
    { selector: 'edge[type = "InZone"]', style: { "line-style": "solid", width: edgeWThin } },
    { selector: 'edge[type = "ConnectsTo"]', style: { "curve-style": "straight", width: edgeWThin } },
    { selector: 'edge[type = "PortOf"]', style: { "line-style": "solid", width: edgeWThin } },
    { selector: 'edge[type = "FillsOpeningIn"]', style: { "line-style": "solid", width: clamp(3 * Math.pow(S, 0.9), 2, 6) } },

    { selector: "node:selected", style: { "border-width": clamp(5 * Math.pow(S, 0.85), 3, 8), "border-color": "#22c55e", "border-opacity": 0.95, "background-opacity": 1 } },
    { selector: "edge:selected", style: { "line-color": "#22c55e", "target-arrow-color": "#22c55e", width: clamp(6 * Math.pow(S, 0.9), 3, 10), opacity: 0.95 } },

    { selector: ".faded", style: { opacity: 0.15, "text-opacity": 0.1 } },
    { selector: ".highlight", style: { "border-width": 4, "border-color": "#2563eb", "background-opacity": 0.95 } },
    { selector: "node.path", style: { "border-width": 4, "border-color": "#2563eb", "background-opacity": 0.98 } },
    { selector: "edge.path", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },
    { selector: "edge.path.upstream", style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
    { selector: "edge.path.downstream", style: { "line-color": "#10b981", "target-arrow-color": "#10b981" } },

    { selector: ".lod-low", style: { "text-opacity": 0 } },
    { selector: "edge.lod-low", style: { label: "", "curve-style": "haystack", "target-arrow-shape": "none" } },
    { selector: "node.lod-low", style: { label: "", "text-opacity": 0 } },
    { selector: "node.lod-mid", style: { label: "data(displayLabel)", "text-opacity": 1 } },
    { selector: "edge.lod-mid", style: { label: "", "curve-style": "straight", "target-arrow-shape": "none" } },
    { selector: "edge.lod-high", style: { label: "data(displayType)", "curve-style": "bezier", "target-arrow-shape": (ele) => (ele.data("directional") ? "triangle" : "none") } },

    { selector: "edge.nestEdge", style: { "line-color": "#607D8B", width: clamp(4 * Math.pow(S, 0.9), 2, 7) } },
    { selector: "edge.nonNestEdge", style: { opacity: 0.25 } },

    { selector: "node.diff-added", style: { "border-width": 4, "border-color": "#10b981" } },
    { selector: "node.diff-removed", style: { "border-width": 4, "border-color": "#ef4444", opacity: 0.65 } },
    { selector: "node.diff-changed", style: { "border-width": 4, "border-color": "#f59e0b" } },
    { selector: "edge.diff-added", style: { "line-color": "#10b981", "target-arrow-color": "#10b981", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },
    { selector: "edge.diff-removed", style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", "line-style": "dashed", width: clamp(4 * Math.pow(S, 0.9), 2, 7), opacity: 0.7 } },
    { selector: "edge.diff-changed", style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b", width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    { selector: "edge.conf-inferred", style: { "line-style": "dashed", opacity: 0.65 } },
    { selector: "edge.layer-risk", style: { "text-opacity": 1 } },
    { selector: 'node[layer-option][nodeType = "Option"]', style: { "border-width": 4, "border-color": "#6366f1" } },
    { selector: 'edge[layer-option][type = "Optimizes"]', style: { width: clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    // Visibility toggles (class-based)
    { selector: ".layer-hide", style: { display: "none" } },
    { selector: ".onx-hide-filter", style: { display: "none" } },
    { selector: ".onx-hide-end", style: { display: "none" } },
    { selector: ".onx-hide-compare", style: { display: "none" } },
    { selector: ".onx-hide-reveal", style: { display: "none" } },
    { selector: ".onx-hide-node-vis", style: { display: "none" } },
    { selector: ".onx-hide-isolated", style: { display: "none" } },

    // Perf: Hide labels during load/layout (temp class)
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
  // ensure built-ins are registered
  window.ONEXUS?.style?.listColorModes?.();

  currentColorMode = String(mode ?? "json_category").trim() || "json_category";
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);
  window.buildRelationshipLegend?.();

  // sync dropdown options (plugins may register later)
  try { window.ONEXUS?.style?.syncColorModeSelect?.(); } catch { }
}

function applyTheme(themeKey) {
  currentTheme = themeKey === "dark" ? "dark" : "light";
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
window.getCurrentScale = getCurrentScale;