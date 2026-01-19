/* ===============================
   NEXUS – Graph Logic
=============================== */

let currentLanguage = "en";

const LABELS = {
  en: {
    Controls: "Controls",
    LocatedIn: "Located In",
    DesignedBy: "Designed By",
    BuiltBy: "Built By",
    ProvidedBy: "Provided By"
  },
  jp: {
    Controls: "制御",
    LocatedIn: "設置場所",
    DesignedBy: "設計担当",
    BuiltBy: "施工担当",
    ProvidedBy: "提供元"
  }
};

const cy = cytoscape({
  container: document.getElementById("cy"),
  elements: [],
  style: NEXUS_STYLE,

  minZoom: 0.2,
  maxZoom: 3,

  wheelSensitivity: 0.2
});

/* ---------- Language ---------- */

function setLanguage(lang) {
  currentLanguage = lang;
  cy.nodes().forEach(n => {
    n.data("displayLabel", n.data(lang === "jp" ? "label_jp" : "label"));
  });
  cy.edges().forEach(e => {
    e.data("displayType", LABELS[lang][e.data("type")] || e.data("type"));
  });
}

/* ---------- Filters ---------- */

function buildCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  select.innerHTML = `<option value="ALL">All Categories</option>`;
  [...new Set(cy.nodes().map(n => n.data("category")))].forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

function filterByCategory(cat) {
  cy.nodes().forEach(n => {
    n.style("display", cat === "ALL" || n.data("category") === cat ? "element" : "none");
  });
  syncEdges();
}

function filterByDimension(dim) {
  cy.edges().forEach(e => {
    e.style("display", e.data("dimension") === dim ? "element" : "none");
  });
}

function showAllEdges() {
  cy.edges().style("display", "element");
}

/* ---------- Views ---------- */

function applyLayout(type) {
  let layout;

  switch (type) {

    case "system":
      layout = {
        name: "concentric",
        concentric: n => n.data("system") ? 2 : 1,
        levelWidth: () => 1,
        spacingFactor: 1.6,
        animate: true
      };
      break;

    case "responsibility":
      layout = {
        name: "breadthfirst",
        roots: cy.nodes('[category = "Organization"]'),
        directed: false,
        spacingFactor: 1.4,
        animate: true
      };
      break;

    case "spatial":
      layout = {
        name: "breadthfirst",
        roots: cy.nodes('[category = "Room"]'),
        directed: false,
        spacingFactor: 1.5,
        animate: true
      };
      break;

    default:
      layout = {
        name: "cose",
        animate: true
      };
  }

  cy.layout(layout).run();
}

function resetView() {
  cy.nodes().style("display", "element");
  cy.edges().style("display", "element");
  cy.layout({ name: "cose" }).run();
}

function setTheme(theme) {
  applyTheme(theme);
}

/* ---------- Interaction ---------- */

cy.on("tap", "node", evt => {
  cy.elements().addClass("faded");
  evt.target.removeClass("faded");
  evt.target.connectedEdges().removeClass("faded");
  evt.target.connectedEdges().connectedNodes().removeClass("faded");

  const d = evt.target.data();
  document.getElementById("details").innerHTML = `
    <b>${d.displayLabel}</b><br>
    Category: ${d.category}<br>
    Level: ${d.level || "-"}<br>
    System: ${d.system || "-"}
  `;
});

cy.on("tap", "edge", evt => {
  const d = evt.target.data();
  document.getElementById("details").innerHTML = `
    <b>${d.displayType}</b><br>
    Dimension: ${d.dimension}<br>
    Phase: ${(d.phase || []).join(", ")}<br>
    Confidence: ${d.confidence}
  `;
});

/* ---------- Helpers ---------- */

function syncEdges() {
  cy.edges().forEach(e => {
    e.style("display",
      e.source().style("display") === "element" &&
      e.target().style("display") === "element"
        ? "element" : "none");
  });
}

function loadJSON(event) {
  const reader = new FileReader();
  reader.onload = e => {
    const data = JSON.parse(e.target.result);
    cy.elements().remove();
    cy.add(data.elements.nodes);
    cy.add(data.elements.edges);

    setLanguage(currentLanguage);
    buildCategoryFilter();
    
    // 🔥 Run initial layout explicitly
    applyLayout("default");

    // 🔥 Ensure proper zoom & center
    cy.fit(undefined, 50);
  };
  reader.readAsText(event.target.files[0]);
}

function fitView() {
  cy.fit(undefined, 50);
}

function centerView() {
  cy.center();
}

function resetView() {
  applyLayout("default");
  cy.fit(undefined, 50);
}

let lastTap = 0;

cy.on("tap", evt => {
  const now = Date.now();
  if (evt.target === cy && now - lastTap < 300) {
    cy.fit(undefined, 50);
  }
  lastTap = now;
});

cy.layout(layout).run();

const l = cy.layout(layout);
l.run();

l.on("layoutstop", () => {
  cy.fit(undefined, 50);
});
