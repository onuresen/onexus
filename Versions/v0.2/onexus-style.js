
/* ===============================
   ONEXUS – Visual Style (refactored)
   Compatible with current single-file app
================================ */

/* -------------------------------
   Theme palettes
-------------------------------- */
const THEMES = {
  light: {
    canvas: "#F5F7FA",
    text: "#FFFFFF",
    outline: "#000000",
    edgeLabelBg: "#FFFFFF",
    edgeLabelText: "#000000",
  },
  dark: {
    canvas: "#1E1E1E",
    text: "#FFFFFF",
    outline: "#E0E0E0",
    edgeLabelBg: "#2A2A2A",
    edgeLabelText: "#FFFFFF",
  },
};

// current theme state (used by exporters too)
let currentTheme = "light";

/* -------------------------------
   Category & relationship colors
-------------------------------- */
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
};

const RELATIONSHIP_COLORS = {
  Controls: "#FF9800",
  Supplies: "#795548",
  LocatedIn: "#4CAF50",
  DesignedBy: "#3F51B5",
  BuiltBy: "#9C27B0",
  ProvidedBy: "#E91E63",
  PartOfSystem: "#607D8B",
};

function nodeColor(category) {
  return CATEGORY_COLORS[category] ?? "#666";
}
function edgeColor(type) {
  return RELATIONSHIP_COLORS[type] ?? "#999";
}

/* -------------------------------
   Style factory (pure function)
   Returns Cytoscape style JSON for a given theme
-------------------------------- */
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
        width: 60,
        height: 60,
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

    // Faded class (focus feature)
    {
      selector: ".faded",
      style: {
        opacity: 0.15,
        "text-opacity": 0.1,
      },
    },
  ];
}

/* -------------------------------
   Global style (initialized here)
-------------------------------- */
let NEXUS_STYLE = buildStyle(currentTheme);

/* -------------------------------
   Theme application
   (kept compatible with current app)
-------------------------------- */
function applyTheme(themeKey) {
  currentTheme = themeKey;

  // Safety: ensure cy exists (the graph creates it and exposes window.cy)
  const cy = window.cy;
  if (!cy || !cy.container) {
    console.warn("applyTheme: Cytoscape instance not ready.");
    // Still rebuild style so future init can use it
    NEXUS_STYLE = buildStyle(currentTheme);
    return;
  }

  // Update canvas background
  cy.container().style.backgroundColor = THEMES[currentTheme].canvas;

  // Rebuild + apply style
  NEXUS_STYLE = buildStyle(currentTheme);
  cy.style(NEXUS_STYLE);

  // Optional: rebuild legend to reflect any color changes
  if (typeof window.buildRelationshipLegend === "function") {
    window.buildRelationshipLegend();
  }
}

/* -------------------------------
   UI wrapper (index.html calls this)
-------------------------------- */
function setTheme(themeKey) {
  applyTheme(themeKey);
}

// Expose for external usage (exports rely on currentTheme & THEMES)
window.THEMES = THEMES;
window.currentTheme = currentTheme;
window.NEXUS_STYLE = NEXUS_STYLE;
window.applyTheme = applyTheme;
window.setTheme = setTheme;
``
