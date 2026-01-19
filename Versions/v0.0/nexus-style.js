/* ===============================
   NEXUS – Visual Style Definition
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
    outline: "#000000",
    edgeLabelBg: "#2A2A2A",
    edgeLabelText: "#FFFFFF"
  }
};

let currentTheme = "light";

const RELATIONSHIP_COLORS = {
  Controls: "#FF9800",
  Monitors: "#009688",
  Supplies: "#795548",
  LocatedIn: "#4CAF50",
  DesignedBy: "#3F51B5",
  BuiltBy: "#9C27B0",
  ProvidedBy: "#E91E63"
};

function edgeColor(type) {
  return RELATIONSHIP_COLORS[type] || "#999";
}

function nodeColor(category) {
  const map = {
    Door: "#FF9800",
    Wall: "#007ACC",
    SecurityDevice: "#E91E63",
    ControlPanel: "#9C27B0",
    PowerSupply: "#795548",
    Room: "#4CAF50",
    Organization: "#607D8B",
    Vendor: "#795548"
  };
  return map[category] || "#666";
}

const NEXUS_STYLE = [
  {
    selector: "node",
    style: {
      label: "data(displayLabel)",
      "background-color": e => nodeColor(e.data("category")),
      "color": () => THEMES[currentTheme].text,

      "text-wrap": "wrap",
      "text-max-width": "90px",
      "text-outline-width": 2,
      "text-outline-color": () => THEMES[currentTheme].outline,

      "font-size": "10px",
      "font-weight": "bold",
      width: 60,
      height: 60,
      "text-valign": "center",
      "text-halign": "center"
    }
  },

  { selector: 'node[category="Room"]', style: { shape: "round-rectangle" }},
  { selector: 'node[category="Organization"]', style: { shape: "rectangle" }},
  { selector: 'node[category="Vendor"]', style: { shape: "diamond" }},

  {
    selector: "edge",
    style: {
      label: "data(displayType)",
      "line-color": e => edgeColor(e.data("type")),
      "target-arrow-color": e => edgeColor(e.data("type")),
      "target-arrow-shape": e => e.data("directional") ? "triangle" : "none",
      "curve-style": "bezier",
      width: 3,

      "color": () => THEMES[currentTheme].edgeLabelText,
      "text-background-color": () => THEMES[currentTheme].edgeLabelBg,
      "text-background-opacity": 0.85,
      "text-background-padding": "3px",

      "font-size": "9px",
      "text-rotation": "autorotate"
    }
  },

  {
    selector: 'edge[confidence="Inferred"]',
    style: { "line-style": "dashed", opacity: 0.6 }
  },

  {
    selector: ".faded",
    style: { opacity: 0.15, "text-opacity": 0.1 }
  }
];

function applyTheme(theme) {
  currentTheme = theme;
  document.getElementById("cy").style.backgroundColor =
    THEMES[theme].canvas;
  cy.style().update();
}
