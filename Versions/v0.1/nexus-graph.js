/* ===============================
   ONEXUS – Graph Logic (v1.1)
=============================== */

let currentLanguage = "en";
let focusDepth = 1;
let focusedNode = null;

/* ---------- Relationship Labels ---------- */

const LABELS = {
  en: {
    Controls: "Controls",
    Supplies: "Supplies",
    LocatedIn: "Located In",
    DesignedBy: "Designed By",
    BuiltBy: "Built By",
    ProvidedBy: "Provided By",
    PartOfSystem: "Part Of System"
  },
  jp: {
    Controls: "制御",
    Supplies: "供給",
    LocatedIn: "設置場所",
    DesignedBy: "設計担当",
    BuiltBy: "施工担当",
    ProvidedBy: "提供元",
    PartOfSystem: "システム構成"
  }
};

/* ---------- Cytoscape Init ---------- */

const cy = cytoscape({
  container: document.getElementById("cy"),
  elements: [],
  style: NEXUS_STYLE,
  minZoom: 0.2,
  maxZoom: 3,
  wheelSensitivity: 0.2
});

/* ===============================
   Language Handling
=============================== */

function setLanguage(lang) {
  currentLanguage = lang;

  cy.nodes().forEach(n => {
    const labelObj = n.data("label");
    const text =
      labelObj?.[lang] ||
      labelObj?.en ||
      n.data("id");

    n.data("displayLabel", text);
  });

  cy.edges().forEach(e => {
    const t = e.data("type");
    e.data("displayType", LABELS[lang][t] || t);
  });
}

/* ===============================
   Filters
=============================== */

function buildCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  select.innerHTML = `<option value="ALL">All Categories</option>`;

  [...new Set(cy.nodes().map(n => n.data("category")))]
    .filter(Boolean)
    .forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
}

function filterByCategory(cat) {
  cy.nodes().forEach(n => {
    const show =
      cat === "ALL" || n.data("category") === cat;
    n.style("display", show ? "element" : "none");
  });
  syncEdges();
}

function filterByDimension(dim) {
  cy.edges().forEach(e => {
    e.style(
      "display",
      e.data("dimension") === dim ? "element" : "none"
    );
  });
}

function showAllEdges() {
  cy.edges().style("display", "element");
}

/* ===============================
   Views / Layouts
=============================== */

function applyLayout(type) {
  let layout;

  switch (type) {

    case "system":
      layout = {
        name: "breadthfirst",
        roots: cy.nodes('[nodeType = "System"]'),
        directed: false,
        spacingFactor: 1.6,
        animate: true
      };
      break;

    case "responsibility":
      layout = {
        name: "breadthfirst",
        roots: cy.nodes('[nodeType = "Organization"]'),
        directed: false,
        spacingFactor: 1.4,
        animate: true
      };
      break;

    case "spatial":
      layout = {
        name: "breadthfirst",
        roots: cy.nodes('[nodeType = "Space"]'),
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

/* ===============================
   Interaction
=============================== */

cy.on("tap", "node", evt => {
  focusedNode = evt.target;
  applyDepthFocus(focusedNode);

  const d = focusedNode.data();

  document.getElementById("details").innerHTML = `
    <b>${d.displayLabel}</b><br>
    Type: ${d.nodeType || "-"}<br>
    Category: ${d.category || "-"}<br>
    Level: ${d.level || "-"}
  `;
});

cy.on("tap", "edge", evt => {
  const d = evt.target.data();

  document.getElementById("details").innerHTML = `
    <b>${d.displayType}</b><br>
    Dimension: ${d.dimension || "-"}<br>
    Phase: ${(d.phase || []).join(", ")}<br>
    Owner: ${d.owner || "-"}<br>
    Confidence: ${d.confidence || "-"}<br>
    Risk: ${d.risk || "-"}
  `;
});

cy.on("tap", evt => {
  if (evt.target === cy) {
    focusedNode = null;
    cy.elements().removeClass("faded");
  }
});


/* ===============================
   Helpers
=============================== */

function syncEdges() {
  cy.edges().forEach(e => {
    const visible =
      e.source().style("display") === "element" &&
      e.target().style("display") === "element";

    e.style("display", visible ? "element" : "none");
  });
}

/* ===============================
   Load JSON
=============================== */

function loadJSON(event) {
  const reader = new FileReader();

  reader.onload = e => {
    const data = JSON.parse(e.target.result);

    cy.elements().remove();
    cy.add(data.elements.nodes);
    cy.add(data.elements.edges);

    setLanguage(currentLanguage);
    buildCategoryFilter();

    applyLayout("default");
    cy.fit(undefined, 50);
  };

  reader.readAsText(event.target.files[0]);

  buildRelationshipLegend();
}

/* ===============================
   Navigation
=============================== */

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

/* ---------- Double-click fit ---------- */

let lastTap = 0;
cy.on("tap", evt => {
  const now = Date.now();
  if (evt.target === cy && now - lastTap < 300) {
    cy.fit(undefined, 50);
  }
  lastTap = now;
});

function buildRelationshipLegend() {
  const container = document.getElementById("legend");
  container.innerHTML = "";

  const seen = new Set();

  cy.edges().forEach(e => {
    const type = e.data("type");
    if (seen.has(type)) return;
    seen.add(type);

    const color = e.style("line-color");

    const item = document.createElement("div");
    item.className = "legend-item";

    const line = document.createElement("div");
    line.className = "legend-line";
    line.style.backgroundColor = color;

    const label = document.createElement("span");
    label.textContent = e.data("displayType");

    item.appendChild(line);
    item.appendChild(label);
    container.appendChild(item);
  });
}

function setFocusDepth(depth) {
  focusDepth = parseInt(depth);
  document.getElementById("depthLabel").textContent =
    `${focusDepth}-hop`;

  if (focusedNode) {
    applyDepthFocus(focusedNode);
  }
}

function applyDepthFocus(node) {
  cy.elements().addClass("faded");

  let neighborhood = node.closedNeighborhood();

  if (focusDepth >= 2) {
    neighborhood = neighborhood.union(
      node.neighborhood().neighborhood()
    );
  }

  neighborhood.removeClass("faded");
}
