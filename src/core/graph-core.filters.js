/* ONEXUS – Filters, Relationship Legend, Metrics */
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    [...new Set(cy.nodes().map(n => n.data("category")))]
      .filter(Boolean).sort()
      .forEach(cat => { const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat; select.appendChild(opt); });
  }

  function filterByCategory(cat) {
    cy.nodes().forEach(n => n.style("display", (cat === "ALL" || n.data("category") === cat) ? "element" : "none"));
    syncEdges();
    if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }

  function filterByDimension(dim) {
    cy.edges().forEach(e => e.style("display", e.data("dimension") === dim ? "element" : "none"));
    if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }

  let relationshipFilter = null;
  function filterByRelationshipType(type) {
    relationshipFilter = relationshipFilter === type ? null : type;
    cy.edges().forEach(e => e.style("display", !relationshipFilter || e.data("type") === relationshipFilter ? "element" : "none"));
    if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }
  function clearRelationshipFilter() { relationshipFilter = null; cy.edges().style("display", "element"); if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode); buildRelationshipLegend(); updateMetrics(); }
  function showAllEdges() { relationshipFilter = null; cy.edges().style("display", "element"); if (state.focusedNode) window.applyDepthFocus?.(state.focusedNode); buildRelationshipLegend(); updateMetrics(); }

  const syncEdges = (() => { const f = () => {
    cy.edges().forEach(e => {
      const vis = e.source().style("display") === "element" && e.target().style("display") === "element";
      e.style("display", vis ? "element" : "none");
    });
  }; let t; return () => { clearTimeout(t); t = setTimeout(f, 60); }; })();

  const buildRelationshipLegend = (() => {
    const f = () => {
      const container = document.getElementById("legend"); if (!container) return;
      container.innerHTML = ""; const seen = new Set();
      cy.edges(":visible").forEach(e => {
        const type = e.data("type"); if (seen.has(type)) return; seen.add(type);
        const color = e.style("line-color"); const displayType = e.data("displayType") ?? type;
        const item = document.createElement("div"); item.className = "legend-item"; if (relationshipFilter === type) item.classList.add("active");
        const line = document.createElement("div"); line.className = "legend-line"; line.style.backgroundColor = color;
        const label = document.createElement("span"); label.textContent = displayType;
        item.addEventListener("click", () => window.filterByRelationshipType?.(type));
        item.appendChild(line); item.appendChild(label); container.appendChild(item);
      });
    };
    let t; return () => { clearTimeout(t); t = setTimeout(f, 80); };
  })();

  function updateMetrics() {
    const box = document.getElementById("metrics"); if (!box) return;
    const tn = cy.nodes().length, vn = cy.nodes(":visible").length, te = cy.edges().length, ve = cy.edges(":visible").length;
    const density = vn > 1 ? (ve / (vn * (vn - 1))).toFixed(3) : "0";
    box.innerHTML = `<div>Total nodes: ${tn} (visible: ${vn})</div><div>Total edges: ${te} (visible: ${ve})</div><div>Density (visible): ${density}</div>`;
  }

  // expose
  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;
  window.filterByDimension = filterByDimension;
  window.filterByRelationshipType = filterByRelationshipType;
  window.clearRelationshipFilter = clearRelationshipFilter;
  window.showAllEdges = showAllEdges;
  window.buildRelationshipLegend = buildRelationshipLegend;
  window.updateMetrics = updateMetrics;
})();