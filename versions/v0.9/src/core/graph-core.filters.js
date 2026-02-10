/* ONEXUS – Filters, Relationship Legend, Metrics, Phase Filter */
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  // --- internal filter state ---
  let relationshipFilter = null;            // edge.type
  let dimensionFilter = null;               // edge.dimension
  let phaseFilterSet = new Set();           // edge.phase ∩ selected

  // --- CATEGORY (with Revit fallback) ---
  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    const cats = [...new Set(
      cy.nodes().map(n => n.data("category") || n.data("revitCategory"))
    )].filter(Boolean).sort();
    cats.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat; opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  function filterByCategory(cat) {
    cy.nodes().forEach(n => {
      const hit = (n.data("category") || n.data("revitCategory")) === cat;
      n.style("display", (cat === "ALL" || hit) ? "element" : "none");
    });
    syncEdges();
    if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }

  // --- DIMENSION ---
  function filterByDimension(dim) {
    dimensionFilter = dim || null;
    applyEdgeFilters();
  }

  // --- RELATIONSHIP TYPE ---
  function filterByRelationshipType(type) {
    relationshipFilter = (relationshipFilter === type) ? null : type;
    applyEdgeFilters();
  }

  function clearRelationshipFilter() {
    relationshipFilter = null;
    applyEdgeFilters();
  }

  function showAllEdges() {
    relationshipFilter = null;
    dimensionFilter = null;
    phaseFilterSet.clear();
    applyEdgeFilters();
  }

  // --- PHASE (multi-select) ---
  function buildPhaseFilter() {
    const sel = document.getElementById("phaseFilter");
    if (!sel) return;
    const all = new Set();
    cy.edges().forEach(e => {
      const ph = e.data("phase") || [];
      ph.forEach(p => all.add(String(p)));
    });
    const options = [...all].sort();
    sel.innerHTML = "";
    options.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
    // attach once
    if (!sel._onexus_hooked) {
      sel.addEventListener("change", () => {
        const picks = [...sel.selectedOptions].map(o => o.value);
        filterByPhase(picks);
      });
      sel._onexus_hooked = true;
    }
  }

  function filterByPhase(phases) {
    phaseFilterSet = new Set((phases || []).map(String));
    applyEdgeFilters();
  }

  // --- APPLY (edge visibility across all filters) ---
  function applyEdgeFilters() {
    cy.edges().forEach(e => {
      let vis = true;
      if (dimensionFilter) vis = vis && e.data("dimension") === dimensionFilter;
      if (relationshipFilter) vis = vis && e.data("type") === relationshipFilter;
      if (phaseFilterSet.size) {
        const ph = e.data("phase") || [];
        vis = vis && ph.some(p => phaseFilterSet.has(String(p)));
      }
      e.style("display", vis ? "element" : "none");
    });
    syncEdges();
    if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }

  // --- keep edge display off if either endpoint hidden ---
  const syncEdges = (() => {
    const f = () => {
      cy.edges().forEach(e => {
        const endpointsVisible =
          e.source().style("display") === "element" &&
          e.target().style("display") === "element";
        if (e.style("display") !== "none") {
          e.style("display", endpointsVisible ? "element" : "none");
        }
      });
    };
    let t; return () => { clearTimeout(t); t = setTimeout(f, 60); };
  })();

  // --- LEGEND (unchanged behavior) ---
  const buildRelationshipLegend = (() => {
    const f = () => {
      const container = document.getElementById("legend");
      if (!container) return;
      container.innerHTML = "";
      const seen = new Set();
      cy.edges(":visible").forEach(e => {
        const type = e.data("type");
        if (seen.has(type)) return;
        seen.add(type);
        const color = e.style("line-color");
        const displayType = e.data("displayType") ?? type;
        const item = document.createElement("div"); item.className = "legend-item";
        if (relationshipFilter === type) item.classList.add("active");
        const line = document.createElement("div"); line.className = "legend-line";
        line.style.backgroundColor = color;
        const label = document.createElement("span"); label.textContent = displayType;
        item.addEventListener("click", () => window.filterByRelationshipType?.(type));
        item.appendChild(line); item.appendChild(label); container.appendChild(item);
      });
    };
    let t; return () => { clearTimeout(t); t = setTimeout(f, 80); };
  })();

  function updateMetrics() {
    const box = document.getElementById("metrics"); if (!box) return;
    const tn = cy.nodes().length, vn = cy.nodes(":visible").length;
    const te = cy.edges().length, ve = cy.edges(":visible").length;
    const density = vn > 1 ? (ve / (vn * (vn - 1))).toFixed(3) : "0";
    box.innerHTML = `<div>Total nodes: ${tn} (visible: ${vn})</div>
<div>Total edges: ${te} (visible: ${ve})</div>
<div>Density (visible): ${density}</div>`;
  }

  // expose
  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;

  window.filterByDimension = filterByDimension;
  window.filterByRelationshipType = filterByRelationshipType;
  window.clearRelationshipFilter = clearRelationshipFilter;
  window.showAllEdges = showAllEdges;

  window.buildPhaseFilter = buildPhaseFilter;
  window.filterByPhase = filterByPhase;

  window.buildRelationshipLegend = buildRelationshipLegend;
  window.updateMetrics = updateMetrics;
})();