/* ONEXUS – Core State, Boot, i18n, Focus (N-hop), Details, Nav, LOD */
(function () {
  // ---- constants & state
  const LABELS = {
    en: {
      Controls: "Controls",
      Supplies: "Supplies",
      LocatedIn: "Located In",
      DesignedBy: "Designed By",
      BuiltBy: "Built By",
      ProvidedBy: "Provided By",
      PartOfSystem: "Part Of System",
      OfType: "Of Type",
      HasProperties: "Has Properties",
      InZone: "In Zone",
      ConnectsTo: "Connects To",
      PortOf: "Port Of",
      FillsOpeningIn: "Fills Opening In",
    },
    jp: {
      Controls: "制御",
      Supplies: "供給",
      LocatedIn: "設置場所",
      DesignedBy: "設計担当",
      BuiltBy: "施工担当",
      ProvidedBy: "提供元",
      PartOfSystem: "システム構成",
      OfType: "形式",
      HasProperties: "プロパティ有",
      InZone: "ゾーン所属",
      ConnectsTo: "接続",
      PortOf: "ポート所属",
      FillsOpeningIn: "開口充填",
    },
  };
  const DIMENSION_DEFAULTS = ["System", "Spatial", "Responsibility", "Vendor"];
  const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const state = { language: "en", focusDepth: 1, focusedNode: null, showEdgeLabels: true, showNodeLabels: true, lodLevel: "high" };
  const editState = { linkSource: null };

  // ---- cytoscape boot
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: NEXUS_STYLE, // from onexus-style.js
    minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
  });
  window.cy = cy;

  // ---- minimap
  function initNavigator() {
    const host = document.querySelector("#minimap");
    if (!host || typeof cy.navigator !== "function") return;
    try { cy.navigator({ container: "#minimap", viewLiveFramerate: 0, thumbnailEventFramerate: 30, thumbnailLiveFramerate: false, dblClickDelay: 200 }); } catch { /* noop */ }
  }
  initNavigator();

  // ---- toast
  function showTransientMessage(text, timeoutMs = 1800) {
    let el = document.getElementById('onexus-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'onexus-toast';
      Object.assign(el.style, {
        position: 'absolute', right: '12px', bottom: '12px',
        background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '8px 10px',
        borderRadius: '6px', fontSize: '12px', zIndex: 9999, pointerEvents: 'none', maxWidth: '50vw'
      });
      document.body.appendChild(el);
    }
    el.textContent = text; el.style.display = 'block';
    clearTimeout(el._timer); el._timer = setTimeout(() => el.style.display = 'none', timeoutMs);
  }

  // ---- taps
  let lastTap = 0;
  cy.on("tap", (evt) => { const now = Date.now(); if (evt.target === cy && now - lastTap < 300) cy.fit(undefined, 50); lastTap = now; });
  // ---- node interactions: single click = details, double click = focus (N-hop)
  let __lastNodeTapAt = 0;
  let __lastNodeTapId = null;

  cy.on("tap", "node", (evt) => {
    const node = evt.target;
    const now = Date.now();

    // 0) If manual linking is in progress, DO NOT apply focus fading.
    //    Keep your existing "pending link -> open wizard" behavior.
    if (editState.linkSource) {
      if (node !== editState.linkSource) {
        window.hideContextMenu?.();
        window.openEdgeWizard?.(editState.linkSource, node, { mode: "create" });
      }
      // always show details on tap during linking
      updateDetailsForNode(node);
      return;
    }

    // 1) Host bridge selection (keep existing behavior)
    const d = node.data();
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({
        type: "select-node",
        id: d.id,
        revitInstanceIds: d.revitInstanceIds ?? [],
        revitInstanceUids: d.revitInstanceUids ?? []
      });
    }

    // 2) Always update details on single click
    updateDetailsForNode(node);

    // Optional shortcut: Shift+Click => focus immediately
    const oe = evt.originalEvent;
    if (oe && oe.shiftKey) {
      state.focusedNode = node;
      applyDepthFocus(node);
      window.showTransientMessage?.(`Focus applied (${state.focusDepth}-hop).`);
      return;
    }

    // 3) Double click/tap on same node => apply focus (N-hop)
    const isDouble = (__lastNodeTapId === node.id()) && (now - __lastNodeTapAt < 320);
    __lastNodeTapAt = now;
    __lastNodeTapId = node.id();

    if (isDouble) {
      state.focusedNode = node;
      applyDepthFocus(node);
      window.showTransientMessage?.(`Focus applied (${state.focusDepth}-hop).`);
    }
  });
  cy.on("tap", "edge", (evt) => updateDetailsForEdge(evt.target));
  cy.on("tap", (evt) => { if (evt.target === cy) { clearFocus(); setDetailsMessage("Click a node or relationship."); } });

  // ---- i18n
  function setLanguage(lang) {
    state.language = lang;
    cy.nodes().forEach(n => {
      const lbl = n.data("label");
      n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));
    });
    cy.edges().forEach(e => {
      const t = e.data("type");
      e.data("displayType", LABELS[lang]?.[t] ?? t);
    });
    window.buildRelationshipLegend?.();
  }

  // ---- label visibility
  function applyEdgeLabelVisibility() { const o = state.showEdgeLabels ? 1 : 0; cy.edges().forEach(e => e.style("text-opacity", o)); }
  function setEdgeLabelVisibility(show) { state.showEdgeLabels = !!show; applyEdgeLabelVisibility(); }
  function applyNodeLabelVisibility() { const o = state.showNodeLabels ? 1 : 0; cy.nodes().forEach(n => n.style("text-opacity", o)); }
  function setNodeLabelVisibility(show) { state.showNodeLabels = !!show; applyNodeLabelVisibility(); }

  // ---- focus (N-hop)
  function setFocusDepth(depth) {
    state.focusDepth = parseInt(depth, 10) ?? 1;
    const lab = document.getElementById("depthLabel"); if (lab) lab.textContent = `${state.focusDepth}-hop`;
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
  }

  function applyDepthFocus(node) {
    const maxHop = Math.max(1, state.focusDepth | 0);
    cy.elements().addClass("faded");
    let frontier = node.collection();
    let seen = frontier;
    for (let hop = 1; hop <= maxHop; hop++) {
      const neigh = frontier.closedNeighborhood().filter(":visible");
      seen = seen.union(neigh);
      frontier = neigh.nodes();
    }
    seen.removeClass("faded");
  }

  function clearFocus() { state.focusedNode = null; cy.elements().removeClass("faded"); }

  // ---- details
  function setDetailsMessage(html) { const el = document.getElementById("details"); if (el) el.innerHTML = html; }
  function updateDetailsForNode(node) {
    const d = node.data();
    setDetailsMessage(`<b>${d.displayLabel}</b><br>Type: ${d.nodeType ?? "-"}<br>Category: ${d.category ?? d.revitCategory ?? "-"}<br>Level: ${d.level ?? "-"}`);
  }
  function updateDetailsForEdge(edge) {
    const d = edge.data();
    setDetailsMessage(`<b>${d.displayType}</b><br>Dimension: ${d.dimension ?? "-"}<br>Phase: ${(d.phase ?? []).join(", ")}<br>Owner: ${d.owner ?? "-"}<br>Confidence: ${d.confidence ?? "-"}<br>Risk: ${d.risk ?? "-"}`);
  }

  // ---- nav
  const fitView = () => cy.fit(undefined, 50);
  const centerView = () => cy.center();
  function resetView() { window.applyLayout?.("default"); cy.fit(undefined, 50); clearFocus(); }

  // ---- LOD (apply classes based on zoom) – matches styles in onexus-style.js
  function applyLOD() {
    const z = cy.zoom();
    let level = "high";
    if (z < 0.6) level = "low";
    else if (z < 1.4) level = "mid";
    if (level === state.lodLevel) return;
    state.lodLevel = level;

    cy.nodes().removeClass("lod-low lod-mid lod-high");
    cy.edges().removeClass("lod-low lod-mid lod-high");
    const clazz = `lod-${level}`;
    cy.nodes().addClass(clazz);
    cy.edges().addClass(clazz);
  }
  cy.on("zoom", debounce(applyLOD, 50));
  // initialize once
  applyLOD();

  // ---- expose
  window.setLanguage = setLanguage;
  window.setFocusDepth = setFocusDepth;
  window.applyDepthFocus = applyDepthFocus;
  window.setEdgeLabelVisibility = setEdgeLabelVisibility;
  window.setNodeLabelVisibility = setNodeLabelVisibility;
  window.fitView = fitView;
  window.centerView = centerView;
  window.resetView = resetView;
  window.setDetailsMessage = setDetailsMessage;
  window.updateDetailsForNode = updateDetailsForNode;
  window.updateDetailsForEdge = updateDetailsForEdge;
  window.showTransientMessage = showTransientMessage;

  // internals for other modules
  window.__onexus_state = state;
  window.__onexus_edit = editState;
  window.__onexus_labels = LABELS;
  window.__onexus_dims = DIMENSION_DEFAULTS;
})();