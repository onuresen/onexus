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

/* --- NEW: global size scale (no relayout) --- */
let currentScale = 1.0;
window.__onexus_scale = currentScale;

/* Category & relationship colors */
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

const nodeColor = (category) => CATEGORY_COLORS[category] ?? "#666";
const edgeColor = (type) => RELATIONSHIP_COLORS[type] ?? "#999";

/* --- Colorize mode --- */
let currentColorMode = "json_category";
const COLOR_PALETTE = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#64748B",
];
function hashString(str) {
  let h = 2166136261;
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
function nodeColorByMode(ele) {
  const d = ele.data() || {};
  const explicit = d.color || d.fill || d.bg || d.background;
  if (explicit) return explicit;

  const category = d.category || "";
  const nodeType = d.nodeType || d.type || "";

  switch (currentColorMode) {
    case "nodeType":
      return colorFromKey(nodeType || category || d.id);
    case "degree": {
      const deg = ele.degree(false);
      if (deg <= 1) return "#94A3B8";
      if (deg <= 3) return "#3B82F6";
      if (deg <= 6) return "#F59E0B";
      return "#EF4444";
    }
    case "stableRandom":
      return colorFromKey(d.id);
    case "json_category":
    default:
      return CATEGORY_COLORS[category] ?? colorFromKey(category || nodeType || d.id);
  }
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
          try {
            return hooks.nodeLabelFn ? hooks.nodeLabelFn(ele, ctx) : (ele.data("displayLabel") ?? "");
          } catch {
            return ele.data("displayLabel") ?? "";
          }
        },
        "background-color": (ele) => {
          const base = nodeColorByMode(ele);
          try {
            return hooks.nodeColorFn ? hooks.nodeColorFn(ele, { ...ctx, base }) : base;
          } catch {
            return base;
          }
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
          try {
            return hooks.edgeLabelFn ? hooks.edgeLabelFn(ele, ctx) : (ele.data("displayType") ?? ele.data("type") ?? "");
          } catch {
            return ele.data("displayType") ?? ele.data("type") ?? "";
          }
        },
        "line-color": (ele) => {
          const base = edgeColor(ele.data("type"));
          try {
            return hooks.edgeColorFn ? hooks.edgeColorFn(ele, { ...ctx, base }) : base;
          } catch {
            return base;
          }
        },
        "target-arrow-color": (ele) => {
          const base = edgeColor(ele.data("type"));
          try {
            return hooks.edgeColorFn ? hooks.edgeColorFn(ele, { ...ctx, base }) : base;
          } catch {
            return base;
          }
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

    // =====================================================
    // SAFE MODE (large graphs): simplified edge rendering
    // - enabled by adding class "onx-safe" to edges
    // - keeps node styling intact
    // =====================================================
    {
      selector: "edge.onx-safe",
      style: {
        "curve-style": "haystack",
        // reduce label cost / clutter
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

    { selector: ".layer-hide", style: { display: "none" } },
    { selector: ".onx-hide-filter", style: { display: "none" } },
    { selector: ".onx-hide-end", style: { display: "none" } },
    { selector: ".onx-hide-compare", style: { display: "none" } },
    { selector: ".onx-hide-reveal", style: { display: "none" } },
    { selector: ".onx-hide-node-vis", style: { display: "none" } },
    { selector: ".onx-hide-isolated", style: { display: "none" } },
  ];
}

/* Global style instance */
let NEXUS_STYLE = buildStyle(currentTheme);

/* apply size scale without relayout */
function applyScale(scale) {
  currentScale = Math.max(0.5, Math.min(2.0, Number(scale ?? 1.0)));
  window.__onexus_scale = currentScale;
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);
  window.buildRelationshipLegend?.();
}

function applyColorMode(mode) {
  currentColorMode = mode ?? "json_category";
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);
  window.buildRelationshipLegend?.();
}

// Color Mode Registry extension point
(function () {
  window.ONEXUS = window.ONEXUS || {};
  window.ONEXUS.style = window.ONEXUS.style || {};
  const registry = (window.ONEXUS.style._colorModes = window.ONEXUS.style._colorModes || new Map());

  window.ONEXUS.style.registerColorMode = function registerColorMode(key, def) {
    const k = String(key ?? "").trim();
    if (!k) throw new Error("registerColorMode: key required");
    const d = def && typeof def === "object" ? def : {};
    registry.set(k, {
      key: k,
      label: d.label ?? k,
      nodeColorFn: typeof d.nodeColorFn === "function" ? d.nodeColorFn : null,
      edgeColorFn: typeof d.edgeColorFn === "function" ? d.edgeColorFn : null,
    });
    return registry.get(k);
  };

  window.ONEXUS.style.listColorModes = function listColorModes() {
    return Array.from(registry.values());
  };

  window.ONEXUS.style.getColorMode = function getColorMode(key) {
    return registry.get(String(key ?? "").trim()) || null;
  };

  const _applyColorMode = window.applyColorMode;
  window.applyColorMode = function applyColorModePatched(mode) {
    const m = String(mode ?? "").trim();
    const def = window.ONEXUS?.style?.getColorMode?.(m);
    if (def && (def.nodeColorFn || def.edgeColorFn)) {
      window.setStyleHooks?.({
        nodeColorFn: def.nodeColorFn ? (ele, ctx) => (def.nodeColorFn(ele, ctx) ?? ctx.base) : null,
        edgeColorFn: def.edgeColorFn ? (ele, ctx) => (def.edgeColorFn(ele, ctx) ?? ctx.base) : null,
      });
      try { _applyColorMode?.(m); } catch { }
      return;
    }
    window.setStyleHooks?.({ nodeColorFn: null, edgeColorFn: null });
    return _applyColorMode?.(m);
  };
})();

function applyTheme(themeKey) {
  currentTheme = themeKey;
  window.currentTheme = currentTheme;

  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(themeKey === "dark" ? "theme-dark" : "theme-light");

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

/* Expose */
window.applyColorMode = applyColorMode;
window.currentColorMode = () => currentColorMode;
window.THEMES = THEMES;
window.NEXUS_STYLE = NEXUS_STYLE;
window.applyTheme = applyTheme;
window.applyScale = applyScale;
window.getCurrentThemeKey = getCurrentThemeKey;
window.getCurrentScale = getCurrentScale;

// ✅ legacy global value still supported (FIXED: no trailing comma)
window.currentTheme = currentTheme;