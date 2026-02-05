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

  return [
    // Base node
    {
      selector: "node",
      style: {
        label: "data(displayLabel)",
        "background-color": (ele) => nodeColor(ele.data("category")),
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

    // Base edge
    {
      selector: "edge",
      style: {
        label: "data(displayType)",
        "line-color": (ele) => edgeColor(ele.data("type")),
        "target-arrow-color": (ele) => edgeColor(ele.data("type")),
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
  ];
}

/* Global style instance */
let NEXUS_STYLE = buildStyle(currentTheme);

/* Apply theme and update canvas/cy */
function applyTheme(themeKey) {
  currentTheme = themeKey;
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

  // Update Cytoscape instance if available
  const cy = window.cy;
  NEXUS_STYLE = buildStyle(currentTheme);
  if (cy?.container) {
    cy.container().style.backgroundColor = THEMES[currentTheme].canvas;
    cy.style(NEXUS_STYLE);
  }
  window.buildRelationshipLegend?.();
}

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

// Expose
window.THEMES = THEMES;
window.NEXUS_STYLE = NEXUS_STYLE;
window.applyTheme = applyTheme;
window.applyScale = applyScale;
window.currentTheme = currentTheme;
window.currentScale = () => currentScale;