/* ===============================
   ONEXUS – Visual Style (v1.2 SAFE)
   ✔ Cytoscape-compatible
   ✔ Theme switching works
=============================== */

/* ===============================
   Themes
=============================== */

const THEMES = {
  light: {
    canvas: "#F5F7FA",
    text: "#FFFFFF",
    outline: "#000000",
    edgeLabelBg: "#FFFFFF",
    edgeLabelText: "#000000"
  },
  dark: {
    canvas: "#1E1E1E",
    text: "#FFFFFF",
    outline: "#E0E0E0",
    edgeLabelBg: "#2A2A2A",
    edgeLabelText: "#FFFFFF"
  }
};

let currentTheme = "light";

/* ===============================
   Colors
=============================== */

const CATEGORY_COLORS = {
  Door: "#FF9800",
  SecurityDevice: "#E91E63",
  ControlPanel: "#9C27B0",
  PowerSupply: "#795548",
  Room: "#4CAF50",
  DesignTeam: "#607D8B",
  Subcontractor: "#455A64",
  SecurityVendor: "#6D4C41",
  BuildingSystem: "#607D8B"
};

const RELATIONSHIP_COLORS = {
  Controls: "#FF9800",
  Supplies: "#795548",
  LocatedIn: "#4CAF50",
  DesignedBy: "#3F51B5",
  BuiltBy: "#9C27B0",
  ProvidedBy: "#E91E63",
  PartOfSystem: "#607D8B"
};

function nodeColor(category) {
  return CATEGORY_COLORS[category] || "#666";
}

function edgeColor(type) {
  return RELATIONSHIP_COLORS[type] || "#999";
}

/* ===============================
   Style Factory
=============================== */

function buildNexusStyle() {
  return [

    {
      selector: "node",
      style: {
        label: "data(displayLabel)",
        "background-color": e => nodeColor(e.data("category")),
        "color": THEMES[currentTheme].text,

        "text-wrap": "wrap",
        "text-max-width": "90px",
        "text-outline-width": 2,
        "text-outline-color": THEMES[currentTheme].outline,

        "font-size": "10px",
        "font-weight": "bold",
        width: 60,
        height: 60,
        "text-valign": "center",
        "text-halign": "center"
      }
    },

    {
      selector: 'node[nodeType = "System"]',
      style: {
        shape: "hexagon",
        width: 90,
        height: 90,
        "border-width": 1,
        "border-color": THEMES[currentTheme].outline,
        "font-size": "11px"
      }
    },

    {
      selector: 'node[nodeType = "Space"]',
      style: {
        shape: "round-rectangle",
        width: 80,
        height: 50
      }
    },

    {
      selector: 'node[nodeType = "Organization"]',
      style: {
        shape: "rectangle",
        width: 80,
        height: 40
      }
    },

    {
      selector: 'node[nodeType = "Vendor"]',
      style: {
        shape: "diamond",
        width: 70,
        height: 70
      }
    },

    {
      selector: "edge",
      style: {
        label: "data(displayType)",
        "line-color": e => edgeColor(e.data("type")),
        "target-arrow-color": e => edgeColor(e.data("type")),
        "target-arrow-shape": e =>
          e.data("directional") ? "triangle" : "none",

        "curve-style": "bezier",
        width: 3,

        "color": THEMES[currentTheme].edgeLabelText,
        "text-background-color": THEMES[currentTheme].edgeLabelBg,
        "text-background-opacity": 0.9,
        "text-background-padding": "3px",

        "font-size": "9px",
        "text-rotation": "autorotate"
      }
    },

    {
      selector: 'edge[type = "PartOfSystem"]',
      style: {
        "line-style": "dotted",
        width: 2,
        opacity: 0.8
      }
    },

    {
      selector: 'edge[confidence = "Inferred"]',
      style: {
        "line-style": "dashed",
        opacity: 0.6
      }
    },

    {
      selector: ".faded",
      style: {
        opacity: 0.15,
        "text-opacity": 0.1
      }
    }
  ];
}

/* ===============================
   REQUIRED GLOBAL (do not remove)
=============================== */

let NEXUS_STYLE = buildNexusStyle();

/* ===============================
   Theme Application (FIXED)
=============================== */

function applyTheme(theme) {
  currentTheme = theme;

  // Update canvas
  cy.container().style.backgroundColor =
    THEMES[theme].canvas;

  // Rebuild + reapply style
  NEXUS_STYLE = buildNexusStyle();
  cy.style(NEXUS_STYLE);
}
