/* ONEXUS – Layouts & Switcher (balanced spacing + compact grid + fit after chord)
   - Improves spacing for breadthfirst-based views (less empty space)
   - Adds truly compact Compact Grid (tight spacingFactor)
   - Always fits after layout run (consistent with “Free” feel)
*/
(function () {
  const cy = window.cy;
  if (!cy) return;

  // ---------------------------
  // Shared helpers
  // ---------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function visible() { return cy.elements(":visible"); }
  function vNodes() { return cy.nodes(":visible"); }
  function vEdges() { return cy.edges(":visible"); }
  function nodeCount() { return vNodes().length; }

  function autoSpacingFactor() {
    const n = nodeCount();
    if (n <= 10) return 0.85;
    if (n <= 30) return 1.0;
    if (n <= 80) return 1.15;
    return 1.35;
  }

  function autoPadding() {
    const n = nodeCount();
    if (n <= 10) return 40;
    if (n <= 30) return 55;
    if (n <= 80) return 70;
    return 90;
  }

  function runLayout(opts, fitPad) {
    const pad = Number.isFinite(fitPad) ? fitPad : autoPadding();
    // Disable animation above threshold — large graphs (300+ nodes) animate poorly:
    // nodes visibly fly from random positions, labels leak through the hide-during-load system,
    // and the user waits longer for the graph to settle. Instant layout is faster and cleaner.
    const n = nodeCount();
    const shouldAnimate = n <= 300;
    cy.layout({ ...opts, animate: shouldAnimate, padding: pad }).run();
    // Fit after layout settles (prevents huge empty space)
    setTimeout(() => {
      try { cy.fit(visible(), pad); } catch { }
    }, shouldAnimate ? 80 : 10);
  }

  function topDegreeNodes(k = 3) {
    return vNodes().sort((a, b) => b.degree() - a.degree()).slice(0, k);
  }

  // ---------------------------
  // Layout: Category Swimlanes
  // ---------------------------
  function layoutCategorySwimlanes() {
    const groups = new Map();
    vNodes().forEach(n => {
      const cat = n.data("category") ?? n.data("revitCategory") ?? "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(n.id());
    });

    const categories = Array.from(groups.keys()).sort((a, b) => String(a).localeCompare(String(b)));
    const rows = Math.max(1, categories.length);

    let maxPerCat = 1;
    for (const cat of categories) maxPerCat = Math.max(maxPerCat, groups.get(cat).length);
    const cols = Math.max(2, maxPerCat);

    categories.forEach((cat, rowIdx) => {
      const ids = groups.get(cat);
      ids.forEach((id, i) => {
        const n = cy.getElementById(id);
        n.data("_laneRow", rowIdx);
        n.data("_laneCol", i);
      });
    });

    runLayout({
      name: "grid",
      rows,
      cols,
      avoidOverlap: true,
      avoidOverlapPadding: 10,
      spacingFactor: 0.92,
      position: n => ({
        row: n.data("_laneRow") ?? 0,
        col: n.data("_laneCol") ?? 0
      }),
    }, autoPadding());
  }

  // ---------------------------
  // Layout: Degree Rings
  // ---------------------------
  function layoutDegreeRings() {
    runLayout({
      name: "concentric",
      concentric: n => n.degree(),
      levelWidth: () => 2,
      minNodeSpacing: 18,
    }, autoPadding());
  }

  // ---------------------------
  // Layout: Dependency Flow
  // ---------------------------
  function layoutDependencyFlow() {
    const dirEdges = vEdges().filter(e => !!e.data("directional"));
    const touched = dirEdges.connectedNodes(":visible");

    let roots = touched.filter(n => n.indegree() === 0);
    if (roots.length === 0 && touched.length > 0) {
      roots = touched.sort((a, b) => b.outdegree() - a.outdegree()).slice(0, 2);
    }
    if (roots.length === 0) roots = topDegreeNodes(2);

    runLayout({
      name: "breadthfirst",
      roots,
      directed: true,
      spacingFactor: autoSpacingFactor(),
      circle: false,
      grid: true,
    }, autoPadding());
  }

  // ---------------------------
  // Layout: Assembly Chains
  // ---------------------------
  function layoutAssemblyChains() {
    const T = "PartOfSystem";
    const edges = cy.edges(`[type = "${T}"]`).filter(":visible");
    if (!edges.length) return layoutDegreeRings();

    const adj = new Map(), indeg = new Map();
    vNodes().forEach(n => { adj.set(n.id(), []); indeg.set(n.id(), 0); });

    edges.forEach(e => {
      const s = e.data("source"), t = e.data("target");
      if (!adj.has(s)) adj.set(s, []);
      adj.get(s).push(t);
      indeg.set(t, (indeg.get(t) ?? 0) + 1);
    });

    const roots = [];
    adj.forEach((list, id) => {
      if (list.length > 0 && (indeg.get(id) ?? 0) === 0) roots.push(id);
    });
    if (!roots.length) roots.push(...adj.keys());

    const col = new Map(), depth = new Map(), visited = new Set();
    const q = [...roots];
    roots.forEach((r, i) => { col.set(r, i); depth.set(r, 0); });

    while (q.length) {
      const cur = q.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);

      const d = depth.get(cur) ?? 0;
      (adj.get(cur) ?? []).forEach(n => {
        if (!depth.has(n)) depth.set(n, d + 1);
        if (!col.has(n)) col.set(n, col.get(cur) ?? 0);
        q.push(n);
      });
    }

    vNodes().forEach(n => {
      n.data("_chainCol", col.get(n.id()) ?? 0);
      n.data("_chainRow", depth.get(n.id()) ?? 0);
    });

    const cols = Math.max(2, ...Array.from(col.values(), v => v + 1));
    const rows = Math.max(2, ...Array.from(depth.values(), v => v + 1));

    runLayout({
      name: "grid",
      rows,
      cols,
      avoidOverlap: true,
      avoidOverlapPadding: 12,
      spacingFactor: 0.9,
      position: n => ({
        row: n.data("_chainRow") ?? 0,
        col: n.data("_chainCol") ?? 0
      }),
    }, autoPadding());
  }

  // ---------------------------
  // Tree (Nested)
  // ---------------------------
  function pickNestingEdgeType() {
    for (const t of ["PartOfSystem", "LocatedIn", "DependsOn", "Controls", "Monitors", "ConnectsTo"])
      if (cy.edges(`[type = "${t}"]`).length > 0) return t;
    return null;
  }

  function buildNestingEdges(t) {
    let e = cy.edges(`[type = "${t}"]`).filter(":visible");
    if (["DependsOn", "Controls", "Monitors", "ConnectsTo"].includes(t)) {
      const d = e.filter(x => !!x.data("directional"));
      if (d.length > 0) e = d;
    }
    return e;
  }

  function findTreeRoots(nEdges, K = 3) {
    const inM = new Map(), outM = new Map();
    nEdges.forEach(e => {
      const s = e.data("source"), t = e.data("target");
      outM.set(s, (outM.get(s) ?? 0) + 1);
      inM.set(t, (inM.get(t) ?? 0) + 1);
    });

    const candidates = new Set();
    nEdges.connectedNodes(":visible").forEach(n => candidates.add(n.id()));

    const roots = [];
    candidates.forEach(id => { if (!inM.get(id) && outM.get(id)) roots.push(id); });
    if (roots.length) return cy.collection(roots.map(id => cy.getElementById(id)));

    const ranked = Array.from(candidates)
      .sort((a, b) => (outM.get(b) ?? 0) - (outM.get(a) ?? 0))
      .slice(0, Math.min(K, candidates.size));

    return cy.collection(ranked.map(id => cy.getElementById(id)));
  }

  function layoutTreeNested() {
    const t = pickNestingEdgeType();
    if (!t) {
      layoutDegreeRings();
      window.showTransientMessage?.("Tree (Nested): no nesting relations found — showing Degree Rings.");
      return;
    }

    const nEdges = buildNestingEdges(t);
    const roots = findTreeRoots(nEdges, 3);

    cy.edges().removeClass("nestEdge nonNestEdge");
    nEdges.addClass("nestEdge");
    cy.edges().not(nEdges).addClass("nonNestEdge");

    runLayout({
      name: "breadthfirst",
      roots,
      directed: true,
      spacingFactor: autoSpacingFactor(),
      grid: true,
    }, autoPadding());

    window.showTransientMessage?.(`Tree (Nested): using "${t}" as hierarchy relation.`);
  }

  // ---------------------------
  // Compact Grid (improved distance)
  // ---------------------------
  function layoutCompactGrid() {
    // tighter than default grid: keep nodes closer but still avoid overlap
    runLayout({
      name: "grid",
      avoidOverlap: true,
      avoidOverlapPadding: 8,
      spacingFactor: 0.72,        // ✅ tighter spacing
      condense: true,             // ✅ compact packing (supported by Cytoscape grid)
    }, 45);                       // ✅ tighter fit padding
  }

  // ---------------------------
  // Public API
  // ---------------------------
  function applyLayout(type) {
    const breadth = (roots) => ({
      name: "breadthfirst",
      roots,
      directed: false,
      spacingFactor: autoSpacingFactor(),
      grid: true,
    });
    let layout;

    switch (type) {
      case "system": {
        const roots = cy.nodes('[nodeType = "System"]').filter(":visible");
        layout = roots.length ? breadth(roots) : breadth(topDegreeNodes(2));
        break;
      }
      case "responsibility": {
        const roots = cy.nodes('[nodeType = "Organization"]').filter(":visible");
        layout = roots.length ? breadth(roots) : breadth(topDegreeNodes(2));
        break;
      }
      case "spatial": {
        const roots = cy.nodes('[nodeType = "Space"]').filter(":visible");
        layout = roots.length ? breadth(roots) : breadth(topDegreeNodes(2));
        break;
      }
      case "tree_nested":
        return layoutTreeNested();
      case "category_lanes":
        return layoutCategorySwimlanes();
      case "degree_rings":
        return layoutDegreeRings();
      case "dependency_flow":
        return layoutDependencyFlow();
      case "assembly_chains":
        return layoutAssemblyChains();
      case "compact_grid":
        return runLayout({ name: "grid", avoidOverlap: true, avoidOverlapPadding: 14 }, 55);
      default:
        // Spacing derived from actual node sizes so labels get room to breathe.
        // Core cose can't include label boxes in node dimensions, so we widen
        // ideal edge length and repulsion in proportion to the endpoint sizes:
        // big (high-degree) nodes — which also carry the biggest labels — are
        // pushed further apart, while leaf clusters stay compact.
        layout = {
          name: "cose",
          padding: autoPadding(),
          nodeOverlap: 24,
          idealEdgeLength: (edge) => {
            const sw = edge.source().width() || 30;
            const tw = edge.target().width() || 30;
            return 90 + (sw + tw) * 0.9;
          },
          nodeRepulsion: (node) => 9000 + (node.width() || 30) * 450,
          edgeElasticity: 90,
          gravity: 0.3,
          componentSpacing: 80,
          nestingFactor: 1.1,
          randomize: false,
        };
    }

    runLayout(layout, autoPadding());
  }

  window.applyLayout = applyLayout;
})();
