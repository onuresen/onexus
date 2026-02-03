
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
      // SEK      
      DependsOn: "Depends On",
      Monitors: "Monitors",
      ConnectsTo: "Connects To",
    },
    jp: {
      Controls: "制御",
      Supplies: "供給",
      LocatedIn: "設置場所",
      DesignedBy: "設計担当",
      BuiltBy: "施工担当",
      ProvidedBy: "提供元",
      PartOfSystem: "システム構成",
      // SEK      
      DependsOn: "依存",
      Monitors: "監視",
      ConnectsTo: "接続",
    },
  };

  // UI state
  const state = {
    language: "en",
    focusDepth: 1,
    focusedNode: null,
    showEdgeLabels: true, // existing toggle
    showNodeLabels: true  // NEW: global toggle for node text
  };

  // ---- Layout tuning state ----
  const layoutState = {
    // distanceFactor in [0.5, 3.0] (maps from slider 0..100)
    distanceFactor: 1.0,
    // remembers last layout key so we can re-run quickly
    lastViewType: 'free'
  };

  // Map slider (0..100) -> factor (0.8 .. 2.4), midpoint (50) ≈ 1.6
  function sliderToFactor(v) {
    // Map slider (0..100) -> factor (1.2 .. 3.6).
    // Raised minimum further to avoid overly compact graphs.
    const t = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    return 1.2 + t * (3.6 - 1.2);
  }

  // Debounce helper for performance-sensitive handlers
  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /* Cytoscape init */
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

  /* Interactions */
  cy.on("tap", "node", (evt) => {
    const d = evt.target.data();
    // --- notify Revit host (include both ElementId & UniqueId arrays if present) ---
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({
        type: "select-node",
        id: d.id,
        revitInstanceIds: d.revitInstanceIds || [],
        revitInstanceUids: d.revitInstanceUids || []
      });
    }

    // existing local UI logic
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

  /* Language */
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

  /* Filters */
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
    updateMetrics();
  }

  function filterByDimension(dim) {
    cy.edges().forEach((e) => {
      e.style("display", e.data("dimension") === dim ? "element" : "none");
    });
    // When edges are hidden, recompute details/legend/focus
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  // --- Relationship-type filter (legend click) ---
  let relationshipFilter = null; // current relationship type, or null for "no filter"

  function filterByRelationshipType(type) {
    // toggle behavior: clicking again clears the filter
    if (relationshipFilter === type) {
      relationshipFilter = null;
    } else {
      relationshipFilter = type;
    }

    cy.edges().forEach((e) => {
      const matchesType = !relationshipFilter || e.data("type") === relationshipFilter;
      // NOTE: this operates on top of any existing "display" state
      // from dimension/phase/category filters, so "hiding" edges
      // here can only further reduce what is visible.
      e.style("display", matchesType ? "element" : "none");
    });

    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();

  }

  function clearRelationshipFilter() {
    relationshipFilter = null;
    cy.edges().style("display", "element");
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  function showAllEdges() {
    relationshipFilter = null;
    cy.edges().style("display", "element");
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
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

  // -------- Helpers for generalized views --------

  // 1) Category Swimlanes
  function layoutCategorySwimlanes() {
    // Compute category buckets
    const cats = {};
    cy.nodes(':visible').forEach(n => {
      const cat = n.data('category') || n.data('revitCategory') || 'Uncategorized';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(n.id());
    });

    const categories = Object.keys(cats);
    const rows = categories.length;
    const colSize = Math.ceil(Math.sqrt(cy.nodes(':visible').length));

    // Assign a lane index to nodes
    categories.forEach((cat, rowIdx) => {
      cats[cat].forEach((id, i) => {
        const node = cy.getElementById(id);
        node.data('_laneRow', rowIdx);
        node.data('_laneCol', i % colSize);
      });
    });

    cy.layout(
      makeLayoutOptions('grid', {
        rows,
        cols: colSize,
        position: (node) => ({
          row: node.data('_laneRow') ?? 0,
          col: node.data('_laneCol') ?? 0
        })
      })
    ).run();
  }

  // 2) Degree Rings (concentric by degree)
  function layoutDegreeRings() {
    cy.layout(makeLayoutOptions('concentric')).run();
  }

  // 3) Dependency Flow (directed breadth-first with surrogate roots)
  function layoutDependencyFlow() {
    // Use only edges that are effectively directional
    const dirEdges = cy.edges(':visible').filter(e => !!e.data('directional'));
    const touchedNodes = dirEdges.connectedNodes();

    let roots = touchedNodes.filter(n => n.indegree() === 0);
    if (roots.length === 0) {
      // Surrogate: top out-degree nodes
      roots = touchedNodes.sort((a, b) => b.outdegree() - a.outdegree()).slice(0, 3);
    }

    cy.layout(makeLayoutOptions('breadthfirst', {
      roots,
      directed: true
    })).run();
  }

  // 4) Assembly Chains (build simple columns from PartOfSystem chains)
  function layoutAssemblyChains() {
    const chainEdgeType = 'PartOfSystem';
    const edges = cy.edges(`[type = "${chainEdgeType}"]`);
    if (edges.length === 0) return layoutDegreeRings();

    const adj = new Map();
    const indeg = new Map();
    cy.nodes(':visible').forEach(n => { adj.set(n.id(), []); indeg.set(n.id(), 0); });
    edges.forEach(e => {
      const s = e.data('source'), t = e.data('target');
      adj.get(s)?.push(t);
      indeg.set(t, (indeg.get(t) || 0) + 1);
    });

    const roots = [];
    adj.forEach((list, id) => { if (list.length > 0 && (indeg.get(id) || 0) === 0) roots.push(id); });
    if (roots.length === 0) roots.push(...adj.keys());

    const colIndex = new Map();
    roots.forEach((r, i) => colIndex.set(r, i));
    const visited = new Set();
    const depth = new Map();
    const queue = [...roots];
    roots.forEach(r => depth.set(r, 0));

    while (queue.length) {
      const cur = queue.shift();
      if (!visited.has(cur)) {
        visited.add(cur);
        const d = depth.get(cur) || 0;
        const neighbors = adj.get(cur) || [];
        neighbors.forEach(n => {
          if (!visited.has(n)) {
            depth.set(n, d + 1);
            if (!colIndex.has(n)) colIndex.set(n, colIndex.get(cur));
            queue.push(n);
          }
        });
      }
    }

    cy.nodes(':visible').forEach(n => {
      n.data('_chainCol', colIndex.get(n.id()) ?? 0);
      n.data('_chainRow', depth.get(n.id()) ?? 0);
    });

    const cols = Math.max(...Array.from(colIndex.values())) + 1;
    const rows = Math.max(...Array.from(depth.values())) + 1;

    cy.layout(
      makeLayoutOptions('grid', {
        rows,
        cols,
        position: (node) => ({
          row: node.data('_chainRow') ?? 0,
          col: node.data('_chainCol') ?? 0
        })
      })
    ).run();
  }

  // ---------------- Generic Tree (Nested) helpers ----------------

  // Decide which edge type to treat as "nesting" for this graph.
  // Priority: PartOfSystem -> LocatedIn -> (SEP directional): DependsOn/Controls/Monitors/ConnectsTo
  function pickNestingEdgeType() {
    const candidates = [
      'PartOfSystem',      // DOORS assemblies are full of this
      'LocatedIn',         // sample has spatial nesting
      'DependsOn', 'Controls', 'Monitors', 'ConnectsTo' // SEP/SEK style directional edges
    ];

    for (const t of candidates) {
      const count = cy.edges(`[type = "${t}"]`).length;
      if (count > 0) return t;
    }
    return null;
  }

  // Build a directed edge collection for the chosen nesting type.
  // For PartOfSystem & LocatedIn: always treated as directed from parent->child (source->target in data).
  // For SEP types: respect data('directional'); if not directional, we will still include it but as a soft link.
  function buildNestingEdges(edgeType) {
    let edges = cy.edges(`[type = "${edgeType}"]`);

    // If SEP-type and many edges are marked non-directional, prefer the ones explicitly directional
    if (['DependsOn', 'Controls', 'Monitors', 'ConnectsTo'].includes(edgeType)) {
      const directional = edges.filter(e => !!e.data('directional'));
      if (directional.length > 0) edges = directional;
    }

    return edges;
  }

  // Find tree roots: nodes that have outgoing edges in nesting relation but no incoming.
  // If none found, pick top out-degree nodes as surrogates (up to K).
  function findTreeRoots(nestingEdges, K = 5) {
    const incoming = new Map();
    const outgoing = new Map();

    nestingEdges.forEach(e => {
      const s = e.data('source');
      const t = e.data('target');
      outgoing.set(s, (outgoing.get(s) || 0) + 1);
      incoming.set(t, (incoming.get(t) || 0) + 1);
    });

    const candidateNodes = new Set();
    nestingEdges.connectedNodes().forEach(n => candidateNodes.add(n.id()));

    const roots = [];
    candidateNodes.forEach(id => {
      if (!incoming.get(id) && outgoing.get(id)) roots.push(id);
    });

    if (roots.length > 0) return cy.collection(roots.map(id => cy.getElementById(id)));

    // Surrogate: pick top out-degree nodes in the subgraph
    const ranked = Array.from(candidateNodes).sort((a, b) => {
      const oa = outgoing.get(a) || 0;
      const ob = outgoing.get(b) || 0;
      return ob - oa;
    });
    const picks = ranked.slice(0, Math.min(K, ranked.length));
    return cy.collection(picks.map(id => cy.getElementById(id)));
  }

  // Layout the forest as a directed breadth-first tree.
  function layoutTreeNested() {
    const edgeType = pickNestingEdgeType();

    if (!edgeType) {
      cy.layout(makeLayoutOptions('concentric')).run();
      showTransientMessage('Tree (Nested): no nesting relations found — showing Degree Rings.');
      return;
    }

    const nestingEdges = buildNestingEdges(edgeType);
    const roots = findTreeRoots(nestingEdges);

    cy.edges().removeClass('nestEdge nonNestEdge');
    nestingEdges.addClass('nestEdge');
    cy.edges().not(nestingEdges).addClass('nonNestEdge');

    cy.layout(makeLayoutOptions('breadthfirst', {
      roots,
      directed: true,
      padding: 30
    })).run();

    showTransientMessage(`Tree (Nested): using "${edgeType}" as hierarchy relation.`);
  }

  // Tiny toast/helper (optional). Implement minimally with an overlay div.
  function showTransientMessage(text, timeoutMs = 1800) {
    let el = document.getElementById('onexus-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'onexus-toast';
      Object.assign(el.style, {
        position: 'absolute',
        right: '12px',
        bottom: '12px',
        background: 'rgba(0,0,0,0.65)',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: '6px',
        fontSize: '12px',
        zIndex: 9999,
        pointerEvents: 'none',
        maxWidth: '50vw'
      });
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => (el.style.display = 'none'), timeoutMs);
  }

  function makeLayoutOptions(base, extra = {}) {
    const f = layoutState.distanceFactor;

    switch (base) {
      case 'cose': // Free view
        return {
          name: 'cose',
          animate: true,
          // safer, balanced defaults; all still scaled by distanceFactor (f)
          // Further increased base repulsion/edge length so nodes are roomier by default
          nodeRepulsion: n => 10000 * f,
          idealEdgeLength: e => 150 * f,
          edgeElasticity: e => 0.4 / Math.sqrt(f),
          gravity: 1,
          fit: false,
          ...extra
        };

      case 'breadthfirst':
        return {
          name: 'breadthfirst',
          spacingFactor: 1.0 + 0.4 * (f - 1.0),
          animate: true,
          ...extra
        };
      case 'grid':
        return {
          name: 'grid',
          avoidOverlap: true,
          avoidOverlapPadding: 16 * f,
          animate: true,
          ...extra
        };
      case 'concentric':
        return {
          name: 'concentric',
          animate: true,
          concentric: n => n.degree(),
          levelWidth: () => 2,
          nodeSpacing: 9 * f,
          minNodeSpacing: 18 * f,
          ...extra
        };

      default:
        // fallback
        return { name: base, animate: true, ...extra };
    }
  }

  /* Layouts */
  function applyLayout(type) {
    // --- Existing local helpers can remain (some branches still use them for root picking) ---
    function pickSurrogateRoots(k = 3) {
      const arr = cy.nodes(':visible').sort((a, b) => b.degree() - a.degree());
      return arr.slice(0, Math.min(k, arr.length));
    }

    // NOTE: we no longer return raw objects here; we’ll pass roots into makeLayoutOptions
    function breadthWithRoots(roots, directed = false, more = {}) {
      return makeLayoutOptions('breadthfirst', { roots, directed, ...more });
    }

    // Keep a handle to the final layout options so we can run once at the end
    let layoutOpts = null;

    switch (type) {
      // -------------------- Atlas views (rooted breadth-first) --------------------
      case "system": {
        const roots = cy.nodes('[nodeType = "System"]');
        if (roots.length > 0) {
          layoutOpts = breadthWithRoots(roots, /*directed*/ false);
        } else {
          const picks = pickSurrogateRoots(3);
          layoutOpts = picks.length
            ? breadthWithRoots(picks, false)
            : makeLayoutOptions('concentric'); // graceful fallback
        }
        break;
      }
      case "responsibility": {
        const roots = cy.nodes('[nodeType = "Organization"]');
        layoutOpts = roots.length
          ? breadthWithRoots(roots, false)
          : breadthWithRoots(pickSurrogateRoots(3), false);
        break;
      }
      case "spatial": {
        const roots = cy.nodes('[nodeType = "Space"]');
        layoutOpts = roots.length
          ? breadthWithRoots(roots, false)
          : breadthWithRoots(pickSurrogateRoots(3), false);
        break;
      }

      // -------------------- New data-driven views --------------------
      case "tree_nested": {
        // The helper lays out with a directed breadth-first internally
        layoutTreeNested();
        layoutState.lastViewType = "tree_nested";
        return;
      }
      case "category_lanes": {
        // Grid-based swimlanes internally compute rows/cols/position and then run grid
        layoutCategorySwimlanes();
        layoutState.lastViewType = "category_lanes";
        return;
      }
      case "degree_rings": {
        // Concentric with degree-based concentric function
        layoutDegreeRings();
        layoutState.lastViewType = "degree_rings";
        return;
      }
      case "dependency_flow": {
        // Directed breadth-first with auto roots from out-degree
        layoutDependencyFlow();
        layoutState.lastViewType = "dependency_flow";
        return;
      }
      case "assembly_chains": {
        // Grid columns computed from PartOfSystem chains
        layoutAssemblyChains();
        layoutState.lastViewType = "assembly_chains";
        return;
      }

      // -------------------- Free / default --------------------
      default: {
        // Use COSE with distance-aware options
        layoutOpts = makeLayoutOptions('cose');
        break;
      }
    }

    // Run the layout once (for branches that returned options instead of running themselves)
    if (layoutOpts) {
      // Use a layout instance so we can attach a handler specific to this run
      try {
        const layout = cy.layout(layoutOpts);
        layout.one('layoutstop', () => {
          try { cy.resize(); cy.fit(undefined, 80); cy.center(); } catch (e) { }
        });
        layout.run();
      } catch (e) {
        // Fallback: older cytoscape API or unexpected error — try the direct call
        try { cy.layout(layoutOpts).run(); } catch (err) { console.warn('Layout run failed', err); }
      }
    }

    // Remember last view type so the Distance slider can re-apply it
    layoutState.lastViewType = type || 'free';
  }

  function applyEdgeLabelVisibility() {
    const opacity = state.showEdgeLabels ? 1 : 0;
    cy.edges().forEach((e) => {
      e.style("text-opacity", opacity);
    });
  }

  function setEdgeLabelVisibility(show) {
    state.showEdgeLabels = !!show;
    applyEdgeLabelVisibility();
  }

  function applyNodeLabelVisibility() {
    const opacity = state.showNodeLabels ? 1 : 0;
    cy.nodes().forEach((n) => {
      n.style("text-opacity", opacity);
    });
  }

  function setNodeLabelVisibility(show) {
    state.showNodeLabels = !!show;
    applyNodeLabelVisibility();
  }

  /* Load JSON (with validation) */
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

      // Layout & fit — run chosen view, then fit once the layout actually stops
      layoutState.lastViewType = "free";                 // pick an explicit, valid view
      cy.one('layoutstop', () => {
        try { cy.resize(); cy.fit(undefined, 80); cy.center(); } catch (e) { }
      }); // a bit more padding for roomier first view
      applyLayout(layoutState.lastViewType);
      // Fallback: ensure resize+fit+center after a short delay if layoutstop wasn't emitted
      setTimeout(() => {
        try { cy.resize(); cy.fit(undefined, 80); cy.center(); } catch (e) { /* ignore */ }
      }, 450);

      // Edge label visibility (respects current state)
      applyEdgeLabelVisibility();
      applyNodeLabelVisibility();

      // Legend after elements + language are set
      buildRelationshipLegend();
      updateMetrics();

      // mark as loaded (kept here for compatibility if needed)
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

  /* Focus controls */
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

  /* Relationship legend */
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
      const displayType = e.data("displayType") || type;

      const item = document.createElement("div");
      item.className = "legend-item";
      if (relationshipFilter === type) {
        item.classList.add("active"); // highlight selected type
      }

      const line = document.createElement("div");
      line.className = "legend-line";
      line.style.backgroundColor = color;

      const label = document.createElement("span");
      label.textContent = displayType;

      // Click: toggle filter for this relationship type
      item.addEventListener("click", () => {
        window.filterByRelationshipType?.(type);
      });

      item.appendChild(line);
      item.appendChild(label);
      container.appendChild(item);
    });
  }, 80);

  function updateMetrics() {
    const box = document.getElementById("metrics");
    if (!box) return;

    const totalNodes = cy.nodes().length;
    const visibleNodes = cy.nodes(":visible").length;
    const totalEdges = cy.edges().length;
    const visibleEdges = cy.edges(":visible").length;

    let density = "0";
    if (visibleNodes > 1) {
      density = (visibleEdges / (visibleNodes * (visibleNodes - 1))).toFixed(3);
    }

    box.innerHTML = `
        <div>Total nodes: ${totalNodes} (visible: ${visibleNodes})</div>
        <div>Total edges: ${totalEdges} (visible: ${visibleEdges})</div>
        <div>Density (visible): ${density}</div>
      `;
  }

  /* Navigation */
  const fitView = () => cy.fit(undefined, 50);
  const centerView = () => cy.center();
  function resetView() {
    cy.one('layoutstop', () => cy.fit(undefined, 50));
    applyLayout("free");        // or the last selected view
    clearFocus();
  }

  /* Export helpers */
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

  /* Details panel */
  function updateDetailsForNode(node) {
    const d = node.data();
    const html = `<b>${d.displayLabel}</b><br>
      Type: ${d.nodeType ?? "-"}<br>
      Category: ${d.category ?? "-"}<br>
      Level: ${d.level ?? "-"}`;
    setDetailsMessage(html);
  }

  function updateDetailsForEdge(edge) {
    const d = edge.data();
    const html = `<b>${d.displayType}</b><br>
      Dimension: ${d.dimension ?? "-"}<br>
      Phase: ${(d.phase ?? []).join(", ")}<br>
      Owner: ${d.owner ?? "-"}<br>
      Confidence: ${d.confidence ?? "-"}<br>
      Risk: ${d.risk ?? "-"}`;
    setDetailsMessage(html);
  }

  function setDetailsMessage(html) {
    const el = document.getElementById("details");
    if (el) el.innerHTML = html;
  }

  /* Navigator (minimap) */
  function initNavigator() {
    const host = document.querySelector("#minimap");
    if (!host || typeof cy.navigator !== "function") return;
    try {
      cy.navigator({
        container: "#minimap",
        viewLiveFramerate: 0,
        thumbnailEventFramerate: 30,
        thumbnailLiveFramerate: false,
        dblClickDelay: 200,
      });
    } catch (e) {
      console.warn("Navigator init failed:", e);
    }
  }

  const distEl = document.getElementById('distanceRange');
  const distHint = document.getElementById('distanceHint');

  // Set default to a gentler roomy value (≈1.44× from 0.8..2.4 range)
  if (distEl) {
    // Use a slightly larger default for roomier appearance
    distEl.value = 60;
    const factor = sliderToFactor(60);
    layoutState.distanceFactor = factor;
    if (distHint) distHint.textContent = factor.toFixed(2) + '×';
  }

  function rerunCurrentLayout() {
    // Re-run the last chosen view to apply new spacing
    applyLayout(layoutState.lastViewType || 'free');
  }

  distEl?.addEventListener('input', (e) => {
    const val = Number(e.target.value || 40);
    const factor = sliderToFactor(val);
    layoutState.distanceFactor = factor;
    if (distHint) distHint.textContent = factor.toFixed(2) + '×';
    rerunCurrentLayout();
  });

  function loadGraphObject(graph) {
    try {
      const res = typeof validateOnexusJson === 'function'
        ? validateOnexusJson(graph)
        : { valid: true, errors: [] };
      if (res && res.valid === false) {
        console.error('ONEXUS schema errors:', res.errors);
        alert('Invalid ONEXUS JSON:\n' + res.errors.join('\n'));
        return;
      }
      const cy = window.cy;
      if (!cy) { console.error('Cytoscape not ready'); return; }
      cy.elements().remove();
      cy.add(graph.elements?.nodes ?? []);
      cy.add(graph.elements?.edges ?? []);
      // language / UI
      if (typeof window.setLanguage === 'function') window.setLanguage('en');
      if (typeof window.buildCategoryFilter === 'function') window.buildCategoryFilter();
      if (typeof window.applyTheme === 'function') window.applyTheme(localStorage.getItem('onexus.theme') || 'light');
      if (typeof window.applyLayout === 'function') {
        layoutState.lastViewType = 'free';
        cy.one('layoutstop', () => {
          try { cy.resize(); cy.fit(undefined, 80); cy.center(); } catch (e) { }
        });
        window.applyLayout(layoutState.lastViewType);
        // Fallback: ensure resize+fit+center after a short delay if layoutstop wasn't emitted
        setTimeout(() => {
          try { cy.resize(); cy.fit(undefined, 80); cy.center(); } catch (e) { /* ignore */ }
        }, 450);
      } else {
        cy.fit(undefined, 80);
      }
      if (typeof window.setEdgeLabelVisibility === 'function') window.setEdgeLabelVisibility(true);
      if (typeof window.setNodeLabelVisibility === 'function') window.setNodeLabelVisibility(true);
    } catch (e) {
      console.error('Failed to load graph object:', e);
      alert('Failed to load graph: ' + e.message);
    }
  }

  /* Expose functions (for index.html) */
  window.setLanguage = setLanguage;
  window.applyLayout = applyLayout;
  window.loadJSON = loadJSON;
  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;
  window.filterByDimension = filterByDimension;
  window.filterByRelationshipType = filterByRelationshipType;
  window.clearRelationshipFilter = clearRelationshipFilter;
  window.showAllEdges = showAllEdges;
  window.fitView = fitView;
  window.centerView = centerView;
  window.resetView = resetView;
  window.setFocusDepth = setFocusDepth;
  window.setEdgeLabelVisibility = setEdgeLabelVisibility;
  window.setNodeLabelVisibility = setNodeLabelVisibility;
  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;

  // Global entry for Revit
  window.onexusLoadGraph = loadGraphObject;

  // WebView2 message bridge (existing block)
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e) => {
      if (!e || !e.data) return;
      if (e.data.type === 'onexus-graph') {
        loadGraphObject(e.data.graph);             // existing
        return;
      }
      if (e.data.type === 'highlight-nodes') {     // NEW
        const ids = new Set(e.data.ids || []);
        const cy = window.cy;
        cy.nodes().removeClass('highlight');
        const hits = cy.nodes().filter(n => ids.has(n.id()));
        hits.addClass('highlight');
        if (hits.nonempty && hits.nonempty()) cy.fit(hits, 60);
        return;
      }
      if (e.data.type === 'apply-layout') {        // NEW
        const positions = e.data.positions || [];
        if (Array.isArray(positions) && positions.length) {
          window.applyLayoutPositions(positions);
        }
        return;
      }
    });
  }

})();