/* ONEXUS – Core State, Boot, i18n, Focus, Details, Nav */

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

  const state = { language: "en", focusDepth: 1, focusedNode: null, showEdgeLabels: true, showNodeLabels: true };
  const editState = { linkSource: null };

  // ---- cytoscape boot
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: NEXUS_STYLE,    // from onexus-style.js
    minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
  });
  window.cy = cy;

  // ---- minimap
  function initNavigator() {
    const host = document.querySelector("#minimap");
    if (!host || typeof cy.navigator !== "function") return;
    try {
      cy.navigator({ container: "#minimap", viewLiveFramerate: 0, thumbnailEventFramerate: 30, thumbnailLiveFramerate: false, dblClickDelay: 200 });
    } catch { /* noop */ }
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
  cy.on("tap", "node", (evt) => {
    // manual link jump to wizard if pending (from context module)
    if (editState.linkSource && evt.target !== editState.linkSource) { window.hideContextMenu?.(); window.openEdgeWizard?.(editState.linkSource, evt.target, { mode: 'create' }); return; }
    // host bridge (WebView2)
    const d = evt.target.data();
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({ type: "select-node", id: d.id, revitInstanceIds: d.revitInstanceIds ?? [], revitInstanceUids: d.revitInstanceUids ?? [] });
    }
    state.focusedNode = evt.target; applyDepthFocus(state.focusedNode); updateDetailsForNode(state.focusedNode);
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
      e.data("displayType", LABELS[lang][t] ?? t);
    });
    window.buildRelationshipLegend?.();
  }

  // ---- label visibility
  function applyEdgeLabelVisibility() { const o = state.showEdgeLabels ? 1 : 0; cy.edges().forEach(e => e.style("text-opacity", o)); }
  function setEdgeLabelVisibility(show) { state.showEdgeLabels = !!show; applyEdgeLabelVisibility(); }
  function applyNodeLabelVisibility() { const o = state.showNodeLabels ? 1 : 0; cy.nodes().forEach(n => n.style("text-opacity", o)); }
  function setNodeLabelVisibility(show) { state.showNodeLabels = !!show; applyNodeLabelVisibility(); }

  // ---- focus
  function setFocusDepth(depth) {
    state.focusDepth = parseInt(depth, 10) ?? 1;
    const lab = document.getElementById("depthLabel"); if (lab) lab.textContent = `${state.focusDepth}-hop`;
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
  }
  function applyDepthFocus(node) {
    cy.elements().addClass("faded");
    let neigh = node.closedNeighborhood().filter(":visible");
    if (state.focusDepth >= 2) {
      const one = node.neighborhood().filter(":visible");
      const two = one.neighborhood().filter(":visible");
      neigh = neigh.union(two);
    }
    neigh.removeClass("faded");
  }
  function clearFocus() { state.focusedNode = null; cy.elements().removeClass("faded"); }

  // ---- details
  function setDetailsMessage(html) { const el = document.getElementById("details"); if (el) el.innerHTML = html; }
  function updateDetailsForNode(node) {
    const d = node.data();
    setDetailsMessage(`<b>${d.displayLabel}</b><br>Type: ${d.nodeType ?? "-"}<br>Category: ${d.category ?? "-"}<br>Level: ${d.level ?? "-"}`);
  }
  function updateDetailsForEdge(edge) {
    const d = edge.data();
    setDetailsMessage(`<b>${d.displayType}</b><br>Dimension: ${d.dimension ?? "-"}<br>Phase: ${(d.phase ?? []).join(", ")}<br>Owner: ${d.owner ?? "-"}<br>Confidence: ${d.confidence ?? "-"}<br>Risk: ${d.risk ?? "-"}`);
  }

  // ---- nav
  const fitView = () => cy.fit(undefined, 50);
  const centerView = () => cy.center();
  function resetView() { window.applyLayout?.("default"); cy.fit(undefined, 50); clearFocus(); }

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