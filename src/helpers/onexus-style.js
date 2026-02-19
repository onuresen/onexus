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
      buttonHover: "#eef2ff"
    }
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
      buttonHover: "#2A323C"
    }
  }
};
// current theme state (used by exporters too)
let currentTheme = "light";

// =====================================================
// Layer Style Hooks (foundation)
// Layers can override label/color functions without forking buildStyle.
// =====================================================
window.__onexus_styleHooks = window.__onexus_styleHooks || {
  nodeLabelFn: null, // (ele, ctx) => string
  edgeLabelFn: null, // (ele, ctx) => string
  nodeColorFn: null, // (ele, ctx) => color string
  edgeColorFn: null, // (ele, ctx) => color string
};

function setStyleHooks(partial = {}) {
  window.__onexus_styleHooks = window.__onexus_styleHooks || {};
  Object.assign(window.__onexus_styleHooks, partial);
  // reapply current style without relayout
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
let currentScale = 1.0;              // persisted via UI, 0.6 ~ 1.6 recommended
window.__onexus_scale = currentScale; // also readable from style closures

/* Category & relationship colors */
const CATEGORY_COLORS = {
  // existing
  Door: "#FF9800",
  SecurityDevice: "#E91E63",
  ControlPanel: "#9C27B0",
  PowerSupply: "#795548",
  Room: "#4CAF50",
  DesignTeam: "#607D8B",
  Subcontractor: "#455A64",
  SecurityVendor: "#6D4C41",
  BuildingSystem: "#607D8B",
  // IFC-full additions
  Zone: "#3B82F6",
  PropertySet: "#0EA5E9",
  Port: "#14B8A6",
  Type: "#6366F1",
  Wall: "#9CA3AF",
  DoorLike: "#F59E0B",
};
const RELATIONSHIP_COLORS = {
  // existing
  Controls: "#FF9800",
  Supplies: "#795548",
  LocatedIn: "#4CAF50",
  DesignedBy: "#3F51B5",
  BuiltBy: "#9C27B0",
  ProvidedBy: "#E91E63",
  PartOfSystem: "#607D8B",
  // IFC-full additions
  OfType: "#6366F1",
  HasProperties: "#0EA5E9",
  InZone: "#3B82F6",
  ConnectsTo: "#10B981",
  PortOf: "#14B8A6",
  FillsOpeningIn: "#F59E0B",
};
const nodeColor = (category) => CATEGORY_COLORS[category] ?? "#666";
const edgeColor = (type) => RELATIONSHIP_COLORS[type] ?? "#999";

// --- Colorize mode ---
let currentColorMode = "json_category";

// nice palette (stable, readable)
const COLOR_PALETTE = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#64748B"
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

  // 1) respect explicit color if present in JSON
  const explicit = d.color || d.fill || d.bg || d.background;
  if (explicit) return explicit;

  // helpers
  const category = d.category || "";
  const nodeType = d.nodeType || d.type || "";
  const level = d.level || d.jlpt || d.JLPT || "";

  switch (currentColorMode) {
    case "nodeType":
      return colorFromKey(nodeType || category || d.id);

    case "level":
      return colorFromKey(level || "NO_LEVEL");

    case "degree": {
      const deg = ele.degree(false); // undirected degree
      // bucket it
      if (deg <= 1) return "#94A3B8";
      if (deg <= 3) return "#3B82F6";
      if (deg <= 6) return "#F59E0B";
      return "#EF4444";
    }

    case "stableRandom":
      return colorFromKey(d.id);

    case "json_category":
    default:
      // current behavior, but with explicit-color priority above
      return CATEGORY_COLORS[category] ?? colorFromKey(category || nodeType || d.id);
  }
}

/* Style factory (returns Cytoscape style JSON)
   NOTE: This version multiplies node/edge sizes & fonts by current scale (S) without changing positions. */
function buildStyle(themeKey) {
  const T = THEMES[themeKey] ?? THEMES.light;
  // --- scale helpers ---
  const S = Number(window.__onexus_scale ?? currentScale ?? 1.0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // node size derivation
  const nodeBase = (deg) => 40 + deg * 4;
  const nodeSize = (deg) => Math.min(120 * S, nodeBase(deg) * S);
  // fonts
  const fontNode = `${clamp(10 * S, 7, 18)}px`;
  const fontEdge = `${clamp(9 * S, 7, 16)}px`;
  // outlines / paddings
  const textOutlineW = clamp(2 * Math.pow(S, 0.75), 1, 4);
  const textBgPad = `${clamp(3 * S, 2, 8)}px`;
  // edges
  const edgeW = clamp(3 * Math.pow(S, 0.9), 1.5, 6);
  const edgeWThin = clamp(2 * Math.pow(S, 0.9), 1, 5);
  const arrowScale = clamp(1 * Math.pow(S, 0.9), 0.7, 1.6);

  const hooks = window.__onexus_styleHooks || {};
  const ctx = { theme: T, scale: S };

  return [
    // Base node
    {
      selector: "node",
      style: {
        label: (ele) => {
          try {
            return hooks.nodeLabelFn ? hooks.nodeLabelFn(ele, ctx) : (ele.data('displayLabel') ?? '');
          } catch {
            return ele.data('displayLabel') ?? '';
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
    // Node shapes by type (scaled)
    {
      selector: 'node[nodeType = "System"]',
      style: {
        shape: "hexagon",
        width: 90 * S,
        height: 90 * S,
        "border-width": 1,
        "border-color": T.outline,
        "font-size": fontNode,
      },
    },
    {
      selector: 'node[nodeType = "Space"]',
      style: {
        shape: "round-rectangle",
        width: 80 * S,
        height: 50 * S,
      },
    },
    {
      selector: 'node[nodeType = "Organization"]',
      style: {
        shape: "rectangle",
        width: 80 * S,
        height: 40 * S,
      },
    },
    {
      selector: 'node[nodeType = "Vendor"]',
      style: {
        shape: "diamond",
        width: 70 * S,
        height: 70 * S,
      },
    },
    // New shapes for IFC graph
    {
      selector: 'node[nodeType = "ComponentType"]',
      style: {
        shape: "round-rectangle",
        width: 80 * S,
        height: 36 * S,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": `${clamp(10 * S, 7, 16)}px`,
      },
    },
    {
      selector: 'node[nodeType = "PropertySet"]',
      style: {
        shape: "rectangle",
        width: 90 * S,
        height: 36 * S,
        "background-opacity": 0.9,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": `${clamp(10 * S, 7, 16)}px`,
      },
    },
    {
      selector: 'node[nodeType = "Port"]',
      style: {
        shape: "vee",
        width: 46 * S,
        height: 46 * S,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": `${clamp(9 * S, 7, 15)}px`,
      },
    },
    // Link target hover (during drag-to-connect)
    { selector: "node.linkTarget", style: { "border-width": 4, "border-color": "#a855f7" } },

    // Base edge
    {
      selector: "edge",
      style: {
        label: (ele) => {
          try {
            return hooks.edgeLabelFn ? hooks.edgeLabelFn(ele, ctx) : (ele.data('displayType') ?? ele.data('type') ?? '');
          } catch {
            return ele.data('displayType') ?? ele.data('type') ?? '';
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
        "target-arrow-shape": (ele) => ele.data("directional") ? "triangle" : "none",
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

    // Relationship-specific styling
    { selector: 'edge[type = "PartOfSystem"]', style: { "line-style": "dotted", width: edgeWThin, opacity: 0.8 } },
    { selector: 'edge[confidence = "Inferred"]', style: { "line-style": "dashed", opacity: 0.6 } },

    { selector: 'edge[type = "OfType"]', style: { 'line-style': 'dashed', 'width': edgeWThin } },
    { selector: 'edge[type = "HasProperties"]', style: { 'line-style': 'dotted', 'width': edgeWThin } },
    { selector: 'edge[type = "InZone"]', style: { 'line-style': 'solid', 'width': edgeWThin } },
    { selector: 'edge[type = "ConnectsTo"]', style: { 'curve-style': 'straight', 'width': edgeWThin } },
    { selector: 'edge[type = "PortOf"]', style: { 'line-style': 'solid', 'width': edgeWThin } },
    { selector: 'edge[type = "FillsOpeningIn"]', style: { 'line-style': 'solid', 'width': clamp(3 * Math.pow(S, 0.9), 2, 6) } },

    // Faded (focus feature)
    {
      selector: ".faded",
      style: {
        opacity: 0.15,
        "text-opacity": 0.1,
      },
    },

    // Highlight (search results)
    {
      selector: ".highlight",
      style: {
        "border-width": 4,
        "border-color": "#2563eb",
        "background-opacity": 0.95
      }
    },

    // Path / flow highlighting
    {
      selector: "node.path", style: {
        'border-width': 4,
        'border-color': '#2563eb',
        'background-opacity': 0.98,
      }
    },
    {
      selector: "edge.path", style: {
        'line-color': '#2563eb',
        'target-arrow-color': '#2563eb',
        'width': clamp(5 * Math.pow(S, 0.9), 3, 8),
      }
    },
    { selector: "edge.path.upstream", style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b' } },
    { selector: "edge.path.downstream", style: { 'line-color': '#10b981', 'target-arrow-color': '#10b981' } },

    // --- LOD: unchanged semantics ---
    { selector: '.lod-low', style: { 'text-opacity': 0 } },
    { selector: 'edge.lod-low', style: { 'label': '', 'curve-style': 'haystack', 'target-arrow-shape': 'none' } },
    { selector: 'node.lod-low', style: { 'label': '', 'text-opacity': 0 } },

    { selector: 'node.lod-mid', style: { 'label': 'data(displayLabel)', 'text-opacity': 1 } },
    { selector: 'edge.lod-mid', style: { 'label': '', 'curve-style': 'straight', 'target-arrow-shape': 'none' } },

    {
      selector: 'edge.lod-high', style: {
        'label': 'data(displayType)', 'curve-style': 'bezier',
        'target-arrow-shape': (ele) => ele.data('directional') ? 'triangle' : 'none'
      }
    },

    // Emphasize used nesting edges, de-emphasize others
    { selector: 'edge.nestEdge', style: { 'line-color': '#607D8B', 'width': clamp(4 * Math.pow(S, 0.9), 2, 7) } },
    { selector: 'edge.nonNestEdge', style: { 'opacity': 0.25 } },

    // --- Scenario Compare (A/B) diff markers ---
    { selector: "node.diff-added", style: { 'border-width': 4, 'border-color': '#10b981' } },
    { selector: "node.diff-removed", style: { 'border-width': 4, 'border-color': '#ef4444', 'opacity': 0.65 } },
    { selector: "node.diff-changed", style: { 'border-width': 4, 'border-color': '#f59e0b' } },
    { selector: "edge.diff-added", style: { 'line-color': '#10b981', 'target-arrow-color': '#10b981', 'width': clamp(5 * Math.pow(S, 0.9), 3, 8) } },
    { selector: "edge.diff-removed", style: { 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', 'line-style': 'dashed', 'width': clamp(4 * Math.pow(S, 0.9), 2, 7), 'opacity': 0.7 } },
    { selector: "edge.diff-changed", style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', 'width': clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    // --- Risk layer styling helpers ---
    { selector: "edge.conf-inferred", style: { "line-style": "dashed", opacity: 0.65 } },
    { selector: "edge.layer-risk", style: { "text-opacity": 1 } }, // ensure labels visible if needed

    // --- Option layer emphasis ---
    { selector: 'node[layer-option][nodeType = "Option"]', style: { "border-width": 4, "border-color": "#6366f1" } },
    { selector: 'edge[layer-option][type = "Optimizes"]', style: { "width": clamp(5 * Math.pow(S, 0.9), 3, 8) } },

    // Layer additive hide
    { selector: ".layer-hide", style: { display: "none" } },

    // App-level hide flags (class-based; avoids bypass display conflicts)
    { selector: ".onx-hide-filter", style: { display: "none" } },
    { selector: ".onx-hide-end", style: { display: "none" } },
    { selector: ".onx-hide-compare", style: { display: "none" } },
    { selector: ".onx-hide-reveal", style: { display: "none" } },
    // Node visibility (category/type toggles)
    { selector: ".onx-hide-node-vis", style: { display: "none" } },
    // Auto-hide nodes not connected to visible edges while edge-filtering
    { selector: ".onx-hide-isolated", style: { display: "none" } },
  ];
}

/* Global style instance */
let NEXUS_STYLE = buildStyle(currentTheme);

/* --- NEW: apply size scale without relayout --- */
function applyScale(scale) {
  currentScale = Math.max(0.5, Math.min(2.0, Number(scale) || 1.0));
  window.__onexus_scale = currentScale;
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) {
    cy.style(NEXUS_STYLE); // positions preserved; only visuals updated
  }
  window.buildRelationshipLegend?.();
}

function applyColorMode(mode) {
  currentColorMode = mode || "json_category";
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.style) cy.style(NEXUS_STYLE);
  window.buildRelationshipLegend?.();
}


/* Apply theme and update canvas/cy */
function applyTheme(themeKey) {
  currentTheme = themeKey;
  // ✅ keep a live global value for legacy consumers
  window.currentTheme = currentTheme;

  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(themeKey === "dark" ? "theme-dark" : "theme-light");

  // Update CSS variables
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

/* --- NEW: read-only getters used by exporters/others --- */
function getCurrentThemeKey() {
  return currentTheme;
}
function getCurrentScale() {
  return currentScale;
}

/* Expose */
window.applyColorMode = applyColorMode;
window.currentColorMode = () => currentColorMode;

window.THEMES = THEMES;
window.NEXUS_STYLE = NEXUS_STYLE;
window.applyTheme = applyTheme;
window.applyScale = applyScale;

/* ✅ consistent global accessors */
window.getCurrentThemeKey = getCurrentThemeKey;
window.getCurrentScale = getCurrentScale;

/* ✅ legacy global value (string) still supported */
window.currentTheme = currentTheme;