/* Theme palettes */
const THEMES = {
  light: {
    canvas: "#F5F7FA",
    text: "#111827",   // Node label text
    outline: "#FFFFFF",   // Text outline for visibility
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
    text: "#FFFFFF",   // Node label text
    outline: "#000000",   // Text outline for visibility
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

/* Category & relationship colors */
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

/* Style factory (returns Cytoscape style JSON) */
function buildStyle(themeKey) {
  const T = THEMES[themeKey] ?? THEMES.light;

  return [
    // Base node
    {
      selector: "node",
      style: {
        label: "data(displayLabel)",
        "background-color": (ele) => nodeColor(ele.data("category")),
        color: T.text,
        "text-wrap": "wrap",
        "text-max-width": "90px",
        "text-outline-width": 2,
        "text-outline-color": T.outline,
        "font-size": "10px",
        "font-weight": "bold",
        width: (ele) => Math.min(120, 40 + ele.degree() * 4),
        height: (ele) => Math.min(120, 40 + ele.degree() * 4),
        "text-valign": "center",
        "text-halign": "center",
      },
    },

    // Node shapes by type
    {
      selector: 'node[nodeType = "System"]',
      style: {
        shape: "hexagon",
        width: 90,
        height: 90,
        "border-width": 1,
        "border-color": T.outline,
        "font-size": "11px",
      },
    },
    {
      selector: 'node[nodeType = "Space"]',
      style: {
        shape: "round-rectangle",
        width: 80,
        height: 50,
      },
    },
    {
      selector: 'node[nodeType = "Organization"]',
      style: {
        shape: "rectangle",
        width: 80,
        height: 40,
      },
    },
    {
      selector: 'node[nodeType = "Vendor"]',
      style: {
        shape: "diamond",
        width: 70,
        height: 70,
      },
    },

    // New shapes for IFC graph
    {
      selector: 'node[nodeType = "ComponentType"]',
      style: {
        shape: "round-rectangle",
        width: 80,
        height: 36,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": "10px",
      },
    },
    {
      selector: 'node[nodeType = "PropertySet"]',
      style: {
        shape: "rectangle",
        width: 90,
        height: 36,
        "background-opacity": 0.9,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": "10px",
      },
    },
    {
      selector: 'node[nodeType = "Port"]',
      style: {
        shape: "vee",         // visually distinct for ports
        width: 46,
        height: 46,
        "border-width": 1,
        "border-color": THEMES[currentTheme]?.text ?? "#111",
        "font-size": "9px",
      },
    },

    // Base edge
    {
      selector: "edge",
      style: {
        label: "data(displayType)",
        "line-color": (ele) => edgeColor(ele.data("type")),
        "target-arrow-color": (ele) => edgeColor(ele.data("type")),
        "target-arrow-shape": (ele) =>
          ele.data("directional") ? "triangle" : "none",
        "curve-style": "bezier",
        width: 3,
        color: T.edgeLabelText,
        "text-background-color": T.edgeLabelBg,
        "text-background-opacity": 0.9,
        "text-background-padding": "3px",
        "font-size": "9px",
        "text-rotation": "autorotate",
      },
    },

    // Relationship-specific styling
    {
      selector: 'edge[type = "PartOfSystem"]',
      style: {
        "line-style": "dotted",
        width: 2,
        opacity: 0.8,
      },
    },
    {
      selector: 'edge[confidence = "Inferred"]',
      style: {
        "line-style": "dashed",
        opacity: 0.6,
      },
    },
    // Optional: subtle per-relation strokes
    { selector: 'edge[type = "OfType"]', style: { 'line-style': 'dashed', 'width': 2 } },
    { selector: 'edge[type = "HasProperties"]', style: { 'line-style': 'dotted', 'width': 2 } },
    { selector: 'edge[type = "InZone"]', style: { 'line-style': 'solid', 'width': 2 } },
    { selector: 'edge[type = "ConnectsTo"]', style: { 'curve-style': 'straight', 'width': 2 } },
    { selector: 'edge[type = "PortOf"]', style: { 'line-style': 'solid', 'width': 2 } },
    { selector: 'edge[type = "FillsOpeningIn"]', style: { 'line-style': 'solid', 'width': 3 } },

    // Faded class (focus feature)
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
    // --- LOD: default (if no class, behave like mid/high) is what you already have ---

    // Low zoom: hide all labels & arrows, use haystack edges (fast)
    {
      selector: '.lod-low',
      style: { 'text-opacity': 0 }
    },
    {
      selector: 'edge.lod-low',
      style: {
        'label': '',                  // no edge labels
        'curve-style': 'haystack',    // fastest for dense edge sets
        'target-arrow-shape': 'none'  // no arrows
      }
    },
    {
      selector: 'node.lod-low',
      style: {
        'label': '',                  // hide node labels
        'text-opacity': 0
      }
    },

    // Mid zoom: node labels ON, edge labels OFF, arrows OFF, edges straight (cheaper than bezier)
    {
      selector: 'node.lod-mid',
      style: {
        'label': 'data(displayLabel)',
        'text-opacity': 1
      }
    },
    {
      selector: 'edge.lod-mid',
      style: {
        'label': '',                // keep edges unlabeled
        'curve-style': 'straight',  // cheaper than bezier
        'target-arrow-shape': 'none'
      }
    },

    // High zoom: full details (your existing styles already specify label/arrow)
    // We can just ensure edges go back to detailed look:
    {
      selector: 'edge.lod-high',
      style: {
        'label': 'data(displayType)',
        'curve-style': 'bezier',
        'target-arrow-shape': (ele) => ele.data('directional') ? 'triangle' : 'none'
      }
    },
    // Emphasize used nesting edges, de-emphasize others
    { selector: 'edge.nestEdge', style: { 'line-color': '#607D8B', 'width': 4 } },
    { selector: 'edge.nonNestEdge', style: { 'opacity': 0.25 } },
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

  // Rebuild legend
  window.buildRelationshipLegend?.();
}

// Expose for external use
window.THEMES = THEMES;
window.NEXUS_STYLE = NEXUS_STYLE;
window.applyTheme = applyTheme;