// ===============================
// ONEXUS – Graph Core (classic)
// ===============================
(function () {
  // ---------- State & constants ----------
  const LABELS = {
    en: {
      Controls: "Controls", Supplies: "Supplies", LocatedIn: "Located In",
      DesignedBy: "Designed By", BuiltBy: "Built By",
      ProvidedBy: "Provided By", PartOfSystem: "Part Of System"
    },
    jp: {
      Controls: "制御", Supplies: "供給", LocatedIn: "設置場所",
      DesignedBy: "設計担当", BuiltBy: "施工担当",
      ProvidedBy: "提供元", PartOfSystem: "システム構成"
    }
  };

  const state = {
    language: "en",
    focusDepth: 1,
    focusedNode: null,
    initialized: false,
    largeGraph: false,
    spacingBoost: 1.0,
    nodeCount: 0,
    edgeCount: 0
  };

  const LARGENESS = { NODES: 300, EDGES: 600 };
  const ZOOM_TIER = { LOW: 0.7, HIGH: 1.4 };

  const debounce = (fn, ms = 120) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  /**
   * Compute layout parameters smoothly by graph size.
   * The goal: small graphs → close spacing; large graphs → more breathing room.
   * We map nodeCount into a 0..1 range and interpolate reasonable ranges.
   */
  function computeLayoutParams(n, e) {
    // Normalize size in [0,1] using a soft cap around ~1000 nodes & ~2000 edges
    const ns = Math.min(1, n / 1000);
    const es = Math.min(1, e / 2000);
    const s = Math.max(ns, es); // take the larger pressure

    // Interpolate between tiny and huge settings
    const lerp = (a, b, t) => a + (b - a) * t;
    const idealEdgeLength = Math.round(lerp(70, 200, s));     // 70 → 200
    const nodeRepulsion = Math.round(lerp(3500, 16000, s)); // 3.5k → 16k
    const compSpacing = Math.round(lerp(70, 200, s));    // 70 → 200
    const spacingFactorBF = lerp(1.2, 2.2, s);               // breadthfirst spacing
    const numIter = Math.round(lerp(1200, 3000, s));  // more iterations for big

    // spacingBoost used elsewhere; keep near 1 for neutral
    const spacingBoost = 1.0;

    return { idealEdgeLength, nodeRepulsion, compSpacing, spacingFactorBF, numIter, spacingBoost };
  }

  // ---------- Cytoscape init ----------
  const cy = window.cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: window.NEXUS_STYLE, // from onexus-style.js
    minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
    pixelRatio: 1, textureOnViewport: true,
    motionBlur: true, motionBlurOpacity: 0.1
  });
  window.cy = cy; // useful while debugging

  initNavigator();

  // Double-tap fit
  let lastTap = 0;
  cy.on("tap", (evt) => {
    const now = Date.now();
    if (evt.target === cy && now - lastTap < 300) cy.fit(undefined, 50);
    lastTap = now;
  });

  // --- Hover previews (tooltip) ---
  const tip = document.getElementById('hover-tip');
  function showTip(html, pos) {
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.left = (pos.x + 12) + 'px';
    tip.style.top = (pos.y + 12) + 'px';
    tip.style.display = 'block';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  cy.on('mouseover', 'node', (evt) => {
    const d = evt.target.data();
    showTip(`<b>${d.displayLabel}</b><br>${d.nodeType} / ${d.category}`, evt.renderedPosition);
  });
  cy.on('mouseover', 'edge', (evt) => {
    const d = evt.target.data();
    showTip(`<b>${d.displayType}</b><br>${d.dimension}`, evt.renderedPosition);
  });
  cy.on('mouseout', 'node,edge', hideTip);

  // ---------- LOD (zoom-driven) ----------
  function applyLOD() {
    const z = cy.zoom();
    const clearDirect = () => {
      cy.batch(() => {
        cy.nodes().removeStyle("text-opacity");
        cy.edges().removeStyle("curve-style").removeStyle("target-arrow-shape").removeStyle("text-opacity");
      });
    };
    if (z < ZOOM_TIER.LOW) {
      cy.batch(() => {
        cy.nodes().style("text-opacity", 0);
        cy.edges().style("curve-style", "haystack").style("target-arrow-shape", "none").style("text-opacity", 0);
      });
      return;
    }
    if (z < ZOOM_TIER.HIGH) {
      cy.batch(() => {
        cy.nodes().style("text-opacity", 1);
        cy.edges().style("curve-style", "straight").style("target-arrow-shape", "none").style("text-opacity", 0);
      });
      return;
    }
    clearDirect();
  }
  applyLOD();
  cy.on("zoom", () => applyLOD());

  // ---------- Interactions ----------
  cy.on("tap", "node", (evt) => {
    state.focusedNode = evt.target;
    applyDepthFocus(state.focusedNode);
    updateDetailsForNode(state.focusedNode);
  });
  cy.on("tap", "edge", (evt) => updateDetailsForEdge(evt.target));
  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      clearFocus();
      setDetailsMessage("Click a node or relationship.");
    }
  });

  // ---------- Language ----------
  function setLanguage(lang) {
    state.language = lang;
    cy.nodes().forEach((n) => {
      const labelObj = n.data("label");
      const text = (labelObj && labelObj[lang]) ?? (labelObj && labelObj["en"]) ?? n.data("id");
      n.data("displayLabel", text);
    });
    cy.edges().forEach((e) => {
      const t = e.data("type");
      e.data("displayType", LABELS[lang][t] ?? t);
    });
    buildRelationshipLegend();
  }

  // ---------- Filters ----------
  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    [...new Set(cy.nodes().map((n) => n.data("category")))]
      .filter(Boolean).sort().forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat; opt.textContent = cat;
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

  // hide edges whose endpoints are hidden
  const syncEdges = debounce(() => {
    cy.edges().forEach((e) => {
      const visible =
        e.source().style("display") === "element" &&
        e.target().style("display") === "element";
      e.style("display", visible ? "element" : "none");
    });
  }, 60);

  // ---------- Layouts ----------
  function applyLayout(type) {
    const animate = !state.largeGraph;
    const { idealEdgeLength, nodeRepulsion, compSpacing, spacingFactorBF, numIter, spacingBoost } =
      computeLayoutParams(state.nodeCount, state.edgeCount);
    state.spacingBoost = spacingBoost;
    const tiny = state.nodeCount <= 10;
    let layout;
    switch (type) {
      case "system":
        layout = {
          name: "breadthfirst", roots: cy.nodes('[nodeType = "System"]'),
          directed: false,
          spacingFactor: spacingFactorBF,
          nodeDimensionsIncludeLabels: true, animate
        };
        break;
      case "responsibility":
        layout = {
          name: "breadthfirst", roots: cy.nodes('[nodeType = "Organization"]'),
          directed: false,
          spacingFactor: spacingFactorBF,
          nodeDimensionsIncludeLabels: true, animate
        };
        break;
      case "spatial":
        layout = {
          name: "breadthfirst", roots: cy.nodes('[nodeType = "Space"]'),
          directed: false,
          spacingFactor: spacingFactorBF,
          nodeDimensionsIncludeLabels: true, animate
        };
        break;
      default:
        layout = {
          name: "cose", animate, fit: false, nodeDimensionsIncludeLabels: true,
          idealEdgeLength,
          nodeRepulsion,
          nodeOverlap: 10, componentSpacing: compSpacing,
          gravity: 1.0, numIter,
          initialTemp: 200, coolingFactor: 0.95, minTemp: 1.0
        };
    }
    cy.layout(layout).run();
    // Always fit after layout to ensure centered view across sizes
    cy.fit(undefined, 50);
    cy.center();
  }

  // ---------- Load JSON (+ validation) ----------
  function loadJSON(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch (err) { alert("Invalid JSON: " + err.message); return; }

      const { valid, errors } = validateOnexusJson(data);
      if (!valid) { alert("Schema errors:\n" + errors.join("\n")); return; }

      const NODE_COUNT = data.elements.nodes.length;
      const EDGE_COUNT = data.elements.edges.length;
      state.nodeCount = NODE_COUNT;
      state.edgeCount = EDGE_COUNT;
      state.largeGraph = NODE_COUNT > LARGENESS.NODES || EDGE_COUNT > LARGENESS.EDGES;
      // Compute spacing profile (used by applyLayout)
      const lp = computeLayoutParams(NODE_COUNT, EDGE_COUNT);
      state.spacingBoost = lp.spacingBoost;

      // reset scene
      cy.elements().remove();

      // add nodes first
      cy.batch(() => { cy.add(data.elements.nodes); });

      // language + UI (nodes localized immediately)
      setLanguage(state.language);
      buildCategoryFilter();
      buildPhaseFilter(data.meta); // phase options

      // add edges next
      cy.batch(() => { cy.add(data.elements.edges); });

      // final layout after both nodes & edges are present
      applyLayout("default");
      buildRelationshipLegend(); // build after displayType is set
      applyLOD();
      state.initialized = true;
    };
    reader.readAsText(file);
  }

  function validateOnexusJson(data) {
    const errors = [];
    if (!data || !data.elements) { errors.push("Missing `elements`."); return { valid: false, errors }; }
    if (!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");
    (data.elements.nodes || []).forEach((n, i) => {
      const d = n?.data || {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category) errors.push(`nodes[${i}].data.category is required`);
      if (typeof d.label !== "object") errors.push(`nodes[${i}].data.label must be an object`);
    });
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

  // ---------- Focus & details ----------
  function setFocusDepth(depth) {
    state.focusDepth = parseInt(depth, 10) || 1;
    const el = document.getElementById("depthLabel");
    if (el) el.textContent = `${state.focusDepth}-hop`;
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
  }

  function applyDepthFocus(node) {
    cy.elements().addClass("faded");
    let visibleNeighborhood = node.closedNeighborhood().filter(":visible");
    if (state.focusDepth >= 2) {
      const oneHop = node.neighborhood().filter(":visible");
      const twoHop = oneHop.neighborhood().filter(":visible");
      visibleNeighborhood = visibleNeighborhood.union(twoHop);
    }
    cy.batch(() => {
      cy.elements().removeClass("show-label");
      visibleNeighborhood.removeClass("faded").addClass("show-label");
      if (cy.zoom() < 1.4) {
        visibleNeighborhood.nodes().style("text-opacity", 1);
        visibleNeighborhood.edges().style("text-opacity", 1);
      }
    });
  }

  function clearFocus() {
    state.focusedNode = null;
    cy.elements().removeClass("faded show-label");
    applyLOD();
  }

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

  // ---------- Legend ----------
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
      const item = document.createElement("div"); item.className = "legend-item";
      const line = document.createElement("div"); line.className = "legend-line"; line.style.backgroundColor = color;
      // Robust label: prefer displayType; else fall back to language map; else raw type
      const lang = state.language || "en";
      const map = (LABELS[lang] || LABELS["en"] || {});
      const dt = e.data("displayType");
      const labelText = (typeof dt === 'string' && dt.trim().length > 0) ? dt : (map[type] || type);
      const label = document.createElement("span"); label.textContent = e.data("displayType");
      item.appendChild(line); item.appendChild(label); container.appendChild(item);
    });
  }, 80);

  // Phase filter
  function buildPhaseFilter(meta) {
    const sel = document.getElementById('phaseFilter'); if (!sel) return;
    sel.innerHTML = '';
    const phases = (meta?.phases ?? []);
    phases.forEach(ph => {
      const opt = document.createElement('option');
      opt.value = ph; opt.textContent = ph;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      const selected = Array.from(sel.selectedOptions).map(o => o.value);
      cy.edges().forEach(e => {
        const edgePhases = e.data('phase') ?? [];
        const show = selected.length === 0 || edgePhases.some(p => selected.includes(p));
        e.style('display', show ? 'element' : 'none');
      });
      if (state.focusedNode) applyDepthFocus(state.focusedNode);
      buildRelationshipLegend();
    };
  }

  // ---------- Navigation ----------
  function fitView() { cy.fit(undefined, 50); }
  function centerView() { cy.center(); }
  function resetView() { applyLayout("default"); cy.fit(undefined, 50); clearFocus(); }

  // ---------- Exports ----------
  function download(filename, mime, dataUrlOrBlob) {
    const a = document.createElement("a");
    a.href = typeof dataUrlOrBlob === "string" ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportPNG() {
    const png64 = cy.png({ full: true, scale: 2, bg: window.THEMES[window.currentTheme].canvas });
    download("onexus-graph.png", "image/png", png64);
  }
  function exportSVG() {
    if (typeof cy.svg !== "function") { alert("SVG export requires cytoscape-svg plugin."); return; }
    const svgStr = cy.svg({ full: true });
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    download("onexus-graph.svg", "image/svg+xml", blob);
  }
  function exportJSON() {
    const nodes = cy.nodes(":visible").map((n) => ({ data: n.data() }));
    const edges = cy.edges(":visible").map((e) => ({ data: e.data() }));
    const payload = { elements: { nodes, edges }, meta: { exportedAt: new Date().toISOString() } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    download("onexus-graph.json", "application/json", blob);
  }
  function exportCSV() {
    const rows = [["id", "type", "dimension", "directional", "source", "target", "phase", "owner", "risk", "confidence", "notes"]];
    cy.edges(":visible").forEach((e) => {
      const d = e.data();
      rows.push([
        d.id, d.type, d.dimension, d.directional ? "1" : "0", d.source, d.target,
        (d.phase ?? []).join("\n"), d.owner ?? "", d.risk ?? "", d.confidence ?? "", (d.notes ?? "").replace(/\n/g, " ")
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    download("onexus-edges.csv", "text/csv", blob);
  }
  function exportLayout() {
    const pos = cy.nodes().map((n) => ({ id: n.id(), position: n.position() }));
    const blob = new Blob([JSON.stringify({ positions: pos }, null, 2)], { type: "application/json" });
    download("onexus-layout.json", "application/json", blob);
  }

  // ---------- Navigator ----------
  function initNavigator() {
    try {
      const containerSelector = "#minimap";
      const host = document.querySelector(containerSelector);
      if (!host) return;
      if (typeof cy.navigator !== "function") return;
      cy.navigator({
        container: containerSelector,
        viewLiveFramerate: 0,
        thumbnailEventFramerate: 30,
        thumbnailLiveFramerate: false,
        dblClickDelay: 200
      });
    } catch (e) { console.warn("Navigator init failed:", e); }
  }

  // ---------- Expose to window (so index.html inline handlers still work) ----------
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
  window.buildRelationshipLegend = buildRelationshipLegend;
})();