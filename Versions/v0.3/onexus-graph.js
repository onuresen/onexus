
/* ===============================
  ONEXUS – Graph Logic (optimized)
  Performance + Readability edition
================================= */

/* State & constants */
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
    largeGraph: false,   // set after load
    spacingBoost: 1.4,   // boost spacing for readability
  };

  // Heuristics
  const LARGENESS = { NODES: 300, EDGES: 600 };  // tweak as you like
  const ZOOM_TIER = { LOW: 0.7, HIGH: 1.4 };     // LOD breakpoints

  // Debounce helper
  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /* --------------------------
     Cytoscape init (tuned)
  --------------------------- */
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: NEXUS_STYLE, // provided by onexus-style.js

    // PERFORMANCE TUNING
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    pixelRatio: 1,              // huge win on dense graphs
    textureOnViewport: true,    // faster pan/zoom
    motionBlur: true,
    motionBlurOpacity: 0.1
  });

  // Expose cy for theme module (applyTheme uses global `cy`)
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

  /* --------------------------
     LOD (Level of Detail)
     - based on zoom, hide heavy
       decorations when zoomed out
  --------------------------- */
  function applyLOD() {
    const z = cy.zoom();

    // Clear any per-element direct styles we may set below
    const clearDirect = () => {
      cy.batch(() => {
        cy.nodes().removeStyle("text-opacity");
        cy.edges().removeStyle("curve-style")
                   .removeStyle("target-arrow-shape")
                   .removeStyle("text-opacity");
      });
    };

    if (z < ZOOM_TIER.LOW) {
      // LOW: No labels, no arrows, haystack edges (fast)
      cy.batch(() => {
        cy.nodes().style("text-opacity", 0);
        cy.edges()
          .style("curve-style", "haystack")
          .style("target-arrow-shape", "none")
          .style("text-opacity", 0);
      });
      return;
    }

    if (z < ZOOM_TIER.HIGH) {
      // MID: Node labels ON, edge labels OFF, arrows OFF, straight edges for clarity
      cy.batch(() => {
        cy.nodes().style("text-opacity", 1);
        cy.edges()
          .style("curve-style", "straight")
          .style("target-arrow-shape", "none")
          .style("text-opacity", 0);
      });
      return;
    }

    // HIGH: full details -> restore stylesheet-driven defaults
    clearDirect();
  }

  // Run LOD once and on zoom
  applyLOD();
  cy.on("zoom", () => applyLOD());

  /* --------------------------
     Interactions
  --------------------------- */
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

  /* --------------------------
     Language
  --------------------------- */
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

  /* --------------------------
     Filters
  --------------------------- */
  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
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
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const show = cat === "ALL" || n.data("category") === cat;
        n.style("display", show ? "element" : "none");
      });
    });
    syncEdges();
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
  }

  function filterByDimension(dim) {
    cy.batch(() => {
      cy.edges().forEach((e) => {
        const show = e.data("dimension") === dim;
        e.style("display", show ? "element" : "none");
      });
    });
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

  /* --------------------------
     Layouts (readability tuned)
  --------------------------- */
  function applyLayout(type) {
    // Disable animations for large graphs
    const animate = !state.largeGraph;
    const boost = state.spacingBoost;

    let layout;

    switch (type) {
      case "system":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "System"]'),
          directed: false,
          spacingFactor: 1.8 * boost,   // more space between ranks
          nodeDimensionsIncludeLabels: true,
          animate
        };
        break;

      case "responsibility":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "Organization"]'),
          directed: false,
          spacingFactor: 1.7 * boost,
          nodeDimensionsIncludeLabels: true,
          animate
        };
        break;

      case "spatial":
        layout = {
          name: "breadthfirst",
          roots: cy.nodes('[nodeType = "Space"]'),
          directed: false,
          spacingFactor: 1.75 * boost,
          nodeDimensionsIncludeLabels: true,
          animate
        };
        break;

      default:
        // COSE tuned for readability
        layout = {
          name: "cose",
          animate,
          fit: false,
          // These knobs increase distances so labels don't collide
          nodeDimensionsIncludeLabels: true,
          idealEdgeLength: Math.round(110 * boost),
          nodeRepulsion: Math.round(8000 * boost),
          nodeOverlap: 10,
          componentSpacing: Math.round(120 * boost),
          gravity: 1.0,
          numIter: state.largeGraph ? 2500 : 1500,
          initialTemp: 200,
          coolingFactor: 0.95,
          minTemp: 1.0
        };
        break;
    }

    cy.layout(layout).run();
  }

  /* --------------------------
     Load JSON (progressive)
  --------------------------- */
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

      const NODE_COUNT = data.elements.nodes.length;
      const EDGE_COUNT = data.elements.edges.length;
      state.largeGraph = NODE_COUNT > LARGENESS.NODES || EDGE_COUNT > LARGENESS.EDGES;

      // Reset scene
      cy.elements().remove();

      // 1) Add nodes first (batch) for fast first paint
      cy.batch(() => {
        cy.add(data.elements.nodes);
      });

      // 2) Language & UI
      setLanguage(state.language);
      buildCategoryFilter();

      // 3) First layout (fast, non-animated)
      cy.layout({
        name: "cose",
        animate: false,
        fit: false,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: Math.round(100 * state.spacingBoost),
        nodeRepulsion: Math.round(7000 * state.spacingBoost),
        componentSpacing: Math.round(100 * state.spacingBoost),
        nodeOverlap: 10,
        numIter: 1200
      }).run();

      cy.fit(undefined, 50);

      // 4) Add edges afterwards (batch)
      cy.batch(() => {
        cy.add(data.elements.edges);
      });

      // 5) Optional second layout that considers edges (still no animation for large)
      if (state.largeGraph) {
        cy.layout({
          name: "cose",
          animate: false,
          fit: false,
          nodeDimensionsIncludeLabels: true,
          idealEdgeLength: Math.round(120 * state.spacingBoost),
          nodeRepulsion: Math.round(8000 * state.spacingBoost),
          componentSpacing: Math.round(120 * state.spacingBoost),
          nodeOverlap: 10,
          numIter: 1600
        }).run();
      }

      // Legend after elements + language are set
      buildRelationshipLegend();

      // Apply LOD once more (zoom may be different after fit)
      applyLOD();

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

  /* --------------------------
     Focus controls (visible subgraph)
  --------------------------- */
  function setFocusDepth(depth) {
    state.focusDepth = parseInt(depth, 10) || 1;
    const el = document.getElementById("depthLabel");
    if (el) el.textContent = `${state.focusDepth}-hop`;
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

    // Unfade the selected subgraph and force-show labels there
    cy.batch(() => {
      cy.elements().removeClass("show-label");
      visibleNeighborhood.removeClass("faded").addClass("show-label");

      // When zoomed out (LOD low/mid), explicitly show labels for focus
      const z = cy.zoom();
      if (z < ZOOM_TIER.HIGH) {
        visibleNeighborhood.nodes().style("text-opacity", 1);
        visibleNeighborhood.edges().style("text-opacity", 1);
      }
    });
  }

  function clearFocus() {
    state.focusedNode = null;
    cy.elements().removeClass("faded show-label");
    applyLOD(); // restore by zoom tier
  }

  /* --------------------------
     Legend (rebuild when language/theme/filters change)
  --------------------------- */
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

  /* --------------------------
     Navigation
  --------------------------- */
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

  /* --------------------------
     Export helpers
  --------------------------- */
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
        r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
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

  /* --------------------------
     Navigator (minimap)
  --------------------------- */
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

  /* --------------------------
     Expose functions (for index.html)
  --------------------------- */
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

  // Optional: expose spacing control if you want to tweak from console or future UI
  window.setSpacingBoost = function (val) {
    const v = parseFloat(val);
    if (!isNaN(v) && v > 0) {
      state.spacingBoost = v;
      // re-run the current layout (default) without animation for quick feedback
      cy.layout({ name: "cose", animate: false }).run();
    }
  };
})();
