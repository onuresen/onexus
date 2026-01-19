
/* ===============================
   ONEXUS – Graph Logic (refactored)
   Single-file version, ready to split later
================================ */

/* -------------------------------
   State & constants
-------------------------------- */
(function () {
  // Labels for edge types
  const LABELS = {
    en: {
      Controls: "Controls",
      Supplies: "Supplies",
      LocatedIn: "Located In",
      DesignedBy: "Designed By",
      BuiltBy: "Built By",
      ProvidedBy: "Provided By",
      PartOfSystem: "Part Of System",
    },
    jp: {
      Controls: "制御",
      Supplies: "供給",
      LocatedIn: "設置場所",
      DesignedBy: "設計担当",
      BuiltBy: "施工担当",
      ProvidedBy: "提供元",
      PartOfSystem: "システム構成",
    },
  };

  // UI state
  const state = {
    language: "en",
    focusDepth: 1,
    focusedNode: null,
    initialized: false,
  };

  // Debounce helper
  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /* -------------------------------
     Cytoscape init
  -------------------------------- */
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: NEXUS_STYLE, // provided by onexus-style.js
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.2,
  });

  // Expose for current theme module (applyTheme uses global `cy`)
  window.cy = cy;

  // Init navigator (minimap) if plugin & container are present
  initNavigator();

  // Double-tap fit
  let lastTap = 0;
  cy.on("tap", (evt) => {
    const now = Date.now();
    if (evt.target === cy && now - lastTap < 300) {
      cy.fit(undefined, 50);
    }
    lastTap = now;
  });

  /* -------------------------------
     Interactions
  -------------------------------- */
  cy.on("tap", "node", (evt) => {
    state.focusedNode = evt.target;
    applyDepthFocus(state.focusedNode);
    updateDetailsForNode(state.focusedNode);
  });

  cy.on("tap", "edge", (evt) => {
    updateDetailsForEdge(evt.target);
  });

  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      clearFocus();
      setDetailsMessage("Click a node or relationship.");
    }
  });

  /* -------------------------------
     Language
  -------------------------------- */
  function setLanguage(lang) {
    state.language = lang;

    cy.nodes().forEach((n) => {
      const labelObj = n.data("label");
      const text =
        (labelObj && labelObj[lang]) ??
        (labelObj && labelObj["en"]) ??
        n.data("id");
      n.data("displayLabel", text);
    });

    cy.edges().forEach((e) => {
      const t = e.data("type");
      e.data("displayType", LABELS[lang][t] ?? t);
    });

    // Rebuild legend since edge labels changed
    buildRelationshipLegend();
  }

  /* -------------------------------
     Filters
  -------------------------------- */
  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    [...new Set(cy.nodes().map((n) => n.data("category")))]
      .filter(Boolean)
      .sort()
      .forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
      });
  }

  function filterByCategory(cat) {
    cy.nodes().forEach((n) => {
      const show = cat === "ALL" || n.data("category") === cat;
      n.style("display", show ? "element" : "none");
    });
    syncEdges();
    // Focus recalculation on filter change
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
  }

  function filterByDimension(dim) {
    cy.edges().forEach((e) => {
      e.style("display", e.data("dimension") === dim ? "element" : "none");
    });
    // When edges are hidden, recompute details/legend/focus
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
  }

  function showAllEdges() {
    cy.edges().style("display", "element");
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
  }

  // Hide edges whose endpoints are hidden
  const syncEdges = debounce(() => {
    cy.edges().forEach((e) => {
      const visible =
        e.source().style("display") === "element" &&
        e.target().style("display") === "element";
      e.style("display", visible ? "element" : "none");
    });
  }, 60);

  /* -------------------------------
     Layouts
  -------------------------------- */
  function applyLayout(type) {
    let layout;
    switch (type) {
      case "system":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "System"]'),
          directed: false,
          spacingFactor: 1.6,
          animate: true,
        };
        break;
      case "responsibility":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "Organization"]'),
          directed: false,
          spacingFactor: 1.4,
          animate: true,
        };
        break;
      case "spatial":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "Space"]'),
          directed: false,
          spacingFactor: 1.5,
          animate: true,
        };
        break;
      default:
        layout = { name: "cose", animate: true };
    }
    cy.layout(layout).run();
  }

  /* -------------------------------
     Load JSON (with light validation)
  -------------------------------- */
  function loadJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch (err) {
        alert("Invalid JSON: " + err.message);
        return;
      }

      const { valid, errors } = validateOnexusJson(data);
      if (!valid) {
        alert("Schema errors:\n" + errors.join("\n"));
        return;
      }

      cy.elements().remove();
      cy.add(data.elements.nodes);
      cy.add(data.elements.edges);

      // Language & UI
      setLanguage(state.language);
      buildCategoryFilter();

      // Layout & fit
      applyLayout("default");
      cy.fit(undefined, 50);

      // Legend after elements + language are set
      buildRelationshipLegend();

      state.initialized = true;
    };
    reader.readAsText(file);
  }

  function validateOnexusJson(data) {
    const errors = [];
    if (!data || !data.elements) {
      errors.push("Missing `elements`.");
      return { valid: false, errors };
    }
    if (!Array.isArray(data.elements.nodes))
      errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges))
      errors.push("`elements.edges` must be an array.");

    // Node checks
    (data.elements.nodes || []).forEach((n, i) => {
      const d = n?.data || {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category) errors.push(`nodes[${i}].data.category is required`);
      if (typeof d.label !== "object")
        errors.push(`nodes[${i}].data.label must be an object`);
    });

    // Edge checks
    (data.elements.edges || []).forEach((e, i) => {
      const d = e?.data || {};
      if (!d.id) errors.push(`edges[${i}].data.id is required`);
      if (!d.type) errors.push(`edges[${i}].data.type is required`);
      if (!d.dimension) errors.push(`edges[${i}].data.dimension is required`);
      if (!d.source) errors.push(`edges[${i}].data.source is required`);
      if (!d.target) errors.push(`edges[${i}].data.target is required`);
      if (typeof d.directional !== "boolean")
        errors.push(`edges[${i}].data.directional must be boolean`);
    });

    return { valid: errors.length === 0, errors };
  }

  /* -------------------------------
     Focus controls (visible subgraph)
  -------------------------------- */
  function setFocusDepth(depth) {
    state.focusDepth = parseInt(depth, 10) || 1;
    document.getElementById("depthLabel").textContent = `${state.focusDepth}-hop`;
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
  }

  function applyDepthFocus(node) {
    // Start by fading all
    cy.elements().addClass("faded");

    // Work only with visible elements
    let visibleNeighborhood = node.closedNeighborhood().filter(":visible");

    if (state.focusDepth >= 2) {
      // 2-hop: neighborhood of neighbors (still only visible)
      const oneHopNeighbors = node.neighborhood().filter(":visible");
      const twoHop = oneHopNeighbors.neighborhood().filter(":visible");
      visibleNeighborhood = visibleNeighborhood.union(twoHop);
    }

    // Unfade the selected subgraph
    visibleNeighborhood.removeClass("faded");
  }

  function clearFocus() {
    state.focusedNode = null;
    cy.elements().removeClass("faded");
  }

  /* -------------------------------
     Legend (rebuild when language/theme/filters change)
  -------------------------------- */
  const buildRelationshipLegend = debounce(() => {
    const container = document.getElementById("legend");
    if (!container) return;
    container.innerHTML = "";

    const seen = new Set();
    cy.edges(":visible").forEach((e) => {
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
  }, 80);

  /* -------------------------------
     Navigation
  -------------------------------- */
  function fitView() {
    cy.fit(undefined, 50);
  }

  function centerView() {
    cy.center();
  }

  function resetView() {
    applyLayout("default");
    cy.fit(undefined, 50);
    clearFocus();
  }

  /* -------------------------------
     Export helpers
  -------------------------------- */
  function download(filename, mime, dataUrlOrBlob) {
    const a = document.createElement("a");
    if (typeof dataUrlOrBlob === "string") {
      a.href = dataUrlOrBlob;
    } else {
      a.href = URL.createObjectURL(dataUrlOrBlob);
    }
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportPNG() {
    // THEMES & currentTheme are defined in onexus-style.js
    const png64 = cy.png({
      full: true,
      scale: 2,
      bg: THEMES[currentTheme].canvas,
    });
    download("onexus-graph.png", "image/png", png64);
  }

  function exportSVG() {
    // Requires cytoscape-svg plugin
    if (typeof cy.svg === "function") {
      const svgStr = cy.svg({ full: true });
      const blob = new Blob([svgStr], {
        type: "image/svg+xml;charset=utf-8",
      });
      download("onexus-graph.svg", "image/svg+xml", blob);
    } else {
      alert("SVG export requires cytoscape-svg plugin.");
    }
  }

  function exportJSON() {
    // Export only visible elements to honor filters
    const nodes = cy.nodes(":visible").map((n) => ({ data: n.data() }));
    const edges = cy.edges(":visible").map((e) => ({ data: e.data() }));
    const payload = {
      elements: { nodes, edges },
      meta: { exportedAt: new Date().toISOString() },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    download("onexus-graph.json", "application/json", blob);
  }

  function exportCSV() {
    const rows = [
      [
        "id",
        "type",
        "dimension",
        "directional",
        "source",
        "target",
        "phase",
        "owner",
        "risk",
        "confidence",
        "notes",
      ],
    ];
    cy.edges(":visible").forEach((e) => {
      const d = e.data();
      rows.push([
        d.id,
        d.type,
        d.dimension,
        d.directional ? "1" : "0",
        d.source,
        d.target,
        (d.phase ?? []).join("\n"),
        d.owner ?? "",
        d.risk ?? "",
        d.confidence ?? "",
        (d.notes ?? "").replace(/\n/g, " "),
      ]);
    });
    const csv = rows
      .map((r) =>
        r
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    download("onexus-edges.csv", "text/csv", blob);
  }

  function exportLayout() {
    const pos = cy.nodes().map((n) => ({ id: n.id(), position: n.position() }));
    const blob = new Blob([JSON.stringify({ positions: pos }, null, 2)], {
      type: "application/json",
    });
    download("onexus-layout.json", "application/json", blob);
  }

  /* -------------------------------
     Details panel
  -------------------------------- */
  function updateDetailsForNode(node) {
    const d = node.data();
    setDetailsMessage(
      `<b>${d.displayLabel}</b><br>
       Type: ${d.nodeType ?? "-"}<br>
       Category: ${d.category ?? "-"}<br>
       Level: ${d.level ?? "-"}`
    );
  }

  function updateDetailsForEdge(edge) {
    const d = edge.data();
    setDetailsMessage(
      `<b>${d.displayType}</b><br>
       Dimension: ${d.dimension ?? "-"}<br>
       Phase: ${(d.phase ?? []).join(", ")}<br>
       Owner: ${d.owner ?? "-"}<br>
       Confidence: ${d.confidence ?? "-"}<br>
       Risk: ${d.risk ?? "-"}`
    );
  }

  function setDetailsMessage(html) {
    const el = document.getElementById("details");
    if (el) el.innerHTML = html;
  }

  /* -------------------------------
     Navigator (minimap)
  -------------------------------- */
  function initNavigator() {
    try {
      const containerSelector = "#minimap";
      const host = document.querySelector(containerSelector);
      if (!host) return; // silently skip if not present
      if (typeof cy.navigator !== "function") return; // plugin not loaded

      cy.navigator({
        container: containerSelector,
        viewLiveFramerate: 0, // update on drag end
        thumbnailEventFramerate: 30,
        thumbnailLiveFramerate: false,
        dblClickDelay: 200,
      });
    } catch (e) {
      // Fail gracefully; minimap is optional
      console.warn("Navigator init failed:", e);
    }
  }

  /* -------------------------------
     Expose functions (for index.html)
  -------------------------------- */
  window.setLanguage = setLanguage;
  window.applyLayout = applyLayout;
  window.loadJSON = loadJSON;

  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;
  window.filterByDimension = filterByDimension;
  window.showAllEdges = showAllEdges;

  window.fitView = fitView;
  window.centerView = centerView;
  window.resetView = resetView;

  window.setFocusDepth = setFocusDepth;

  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;
})();
