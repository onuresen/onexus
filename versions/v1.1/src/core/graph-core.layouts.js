/* ONEXUS – Layouts & Switcher */
(function () {
  const cy = window.cy;

  function layoutCategorySwimlanes() {
    const cats = {};
    cy.nodes(':visible').forEach(n => {
      const c = n.data('category') ?? n.data('revitCategory') ?? 'Uncategorized';
      (cats[c] ??= []).push(n.id());
    });
    const categories = Object.keys(cats);
    const rows = categories.length;
    const colSize = Math.ceil(Math.sqrt(cy.nodes(':visible').length));
    categories.forEach((cat, rowIdx) => cats[cat].forEach((id, i) => {
      const n = cy.getElementById(id);
      n.data('_laneRow', rowIdx);
      n.data('_laneCol', i % colSize);
    }));
    cy.layout({
      name: 'grid',
      rows, cols: colSize,
      position: n => ({ row: n.data('_laneRow') ?? 0, col: n.data('_laneCol') ?? 0 }),
      avoidOverlap: true, animate: true
    }).run();
  }

  function layoutDegreeRings() {
    cy.layout({ name: 'concentric', animate: true, concentric: n => n.degree(), levelWidth: () => 2, minNodeSpacing: 20 }).run();
  }

  function layoutDependencyFlow() {
    const dirEdges = cy.edges(':visible').filter(e => !!e.data('directional'));
    const touched = dirEdges.connectedNodes();
    let roots = touched.filter(n => n.indegree() === 0);
    if (roots.length === 0) roots = touched.sort((a, b) => b.outdegree() - a.outdegree()).slice(0, 3);
    cy.layout({ name: 'breadthfirst', roots, directed: true, spacingFactor: 1.4, animate: true }).run();
  }

  function layoutAssemblyChains() {
    const T = 'PartOfSystem';
    const edges = cy.edges(`[type = "${T}"]`);
    if (!edges.length) return layoutDegreeRings();
    const adj = new Map(), indeg = new Map();
    cy.nodes(':visible').forEach(n => { adj.set(n.id(), []); indeg.set(n.id(), 0); });
    edges.forEach(e => { const s = e.data('source'), t = e.data('target'); adj.get(s)?.push(t); indeg.set(t, (indeg.get(t) ?? 0) + 1); });
    const roots = [];
    adj.forEach((list, id) => { if (list.length > 0 && (indeg.get(id) ?? 0) === 0) roots.push(id); });
    if (!roots.length) roots.push(...adj.keys());
    const col = new Map(), visited = new Set(), depth = new Map(), q = [...roots];
    roots.forEach((r, i) => { col.set(r, i); depth.set(r, 0); });
    while (q.length) {
      const cur = q.shift();
      if (!visited.has(cur)) {
        visited.add(cur);
        const d = depth.get(cur) ?? 0;
        (adj.get(cur) ?? []).forEach(n => {
          if (!visited.has(n)) {
            depth.set(n, d + 1);
            if (!col.has(n)) col.set(n, col.get(cur));
            q.push(n);
          }
        });
      }
    }
    cy.nodes(':visible').forEach(n => { n.data('_chainCol', col.get(n.id()) ?? 0); n.data('_chainRow', depth.get(n.id()) ?? 0); });
    const cols = Math.max(...Array.from(col.values())) + 1;
    const rows = Math.max(...Array.from(depth.values())) + 1;
    cy.layout({
      name: 'grid', rows, cols,
      position: n => ({ row: n.data('_chainRow') ?? 0, col: n.data('_chainCol') ?? 0 }),
      avoidOverlap: true, animate: true
    }).run();
  }

  function pickNestingEdgeType() {
    for (const t of ['PartOfSystem', 'LocatedIn', 'DependsOn', 'Controls', 'Monitors', 'ConnectsTo'])
      if (cy.edges(`[type = "${t}"]`).length > 0) return t;
    return null;
  }
  function buildNestingEdges(t) {
    let e = cy.edges(`[type = "${t}"]`);
    if (['DependsOn', 'Controls', 'Monitors', 'ConnectsTo'].includes(t)) {
      const d = e.filter(x => !!x.data('directional'));
      if (d.length > 0) e = d;
    }
    return e;
  }
  function findTreeRoots(nEdges, K = 5) {
    const inM = new Map(), outM = new Map();
    nEdges.forEach(e => { const s = e.data('source'), t = e.data('target'); outM.set(s, (outM.get(s) ?? 0) + 1); inM.set(t, (inM.get(t) ?? 0) + 1); });
    const candidates = new Set(); nEdges.connectedNodes().forEach(n => candidates.add(n.id()));
    const roots = [];
    candidates.forEach(id => { if (!inM.get(id) && outM.get(id)) roots.push(id); });
    if (roots.length) return cy.collection(roots.map(id => cy.getElementById(id)));
    const ranked = Array.from(candidates).sort((a, b) => (outM.get(b) ?? 0) - (outM.get(a) ?? 0)).slice(0, Math.min(K, candidates.size));
    return cy.collection(ranked.map(id => cy.getElementById(id)));
  }
  function layoutTreeNested() {
    const t = pickNestingEdgeType();
    if (!t) {
      cy.layout({ name: 'concentric', animate: true, concentric: n => n.degree(), levelWidth: () => 2 }).run();
      window.showTransientMessage?.('Tree (Nested): no nesting relations found — showing Degree Rings.');
      return;
    }
    const nEdges = buildNestingEdges(t); const roots = findTreeRoots(nEdges);
    cy.edges().removeClass('nestEdge'); cy.edges().removeClass('nonNestEdge');
    nEdges.addClass('nestEdge'); cy.edges().not(nEdges).addClass('nonNestEdge');
    cy.layout({ name: 'breadthfirst', roots, directed: true, spacingFactor: 1.35, animate: true, padding: 30 }).run();
    window.showTransientMessage?.(`Tree (Nested): using "${t}" as hierarchy relation.`);
  }

  function applyLayout(type) {
    const picks = (k = 3) => cy.nodes(':visible').sort((a, b) => b.degree() - a.degree()).slice(0, k);
    const breadth = (roots) => ({ name: "breadthfirst", roots, directed: false, spacingFactor: 1.4, animate: true });
    let layout = null;
    switch (type) {
      case "system": {
        const roots = cy.nodes('[nodeType = "System"]');
        layout = roots.length ? breadth(roots) : (picks(3).length ? breadth(picks(3)) : { name: "concentric", animate: true });
        break;
      }
      case "responsibility": {
        const roots = cy.nodes('[nodeType = "Organization"]');
        layout = roots.length ? breadth(roots) : breadth(picks(3));
        break;
      }
      case "spatial": {
        const roots = cy.nodes('[nodeType = "Space"]');
        layout = roots.length ? breadth(roots) : breadth(picks(3));
        break;
      }
      case "tree_nested": return layoutTreeNested();
      case "category_lanes": return layoutCategorySwimlanes();
      case "degree_rings": return layoutDegreeRings();
      case "dependency_flow": return layoutDependencyFlow();
      case "assembly_chains": return layoutAssemblyChains();
      default: layout = { name: "cose", animate: true };
    }
    cy.layout(layout).run();
  }

  // expose
  window.applyLayout = applyLayout;
})();