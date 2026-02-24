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
  // ---- layer mode (persisted) ----
  const LAYER_PREF_KEY = "onexus.layerMode";
  const safeRead = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const safeWrite = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { } };

  // whether to show a message when clicking empty canvas (default: false)
  function getShowEmptyClickMessage() { return safeRead('onexus.showEmptyClickMessage', 'false') === 'true'; }
  window.setShowEmptyClickMessage = (enabled) => { safeWrite('onexus.showEmptyClickMessage', enabled ? 'true' : 'false'); };

  const state = {
    language: "en",
    focusDepth: 1,
    focusedNode: null,
    showEdgeLabels: true,
    showNodeLabels: true,
    lodLevel: "high",
    // NEW: layer mode (controls interpretation + defaults)
    layerMode: safeRead(LAYER_PREF_KEY, "relationship"),
  };
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
  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      clearFocus();
      // Only show the guidance message if explicitly enabled (defaults to off)
      if (getShowEmptyClickMessage()) setDetailsMessage("Click a node or relationship.");
    }
  });

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
  function setDetailsMessage(html) {
    // Prefer #details (older layout) but fall back to floating details body
    const el = document.getElementById("details") || document.getElementById("onxFloatDetailsBody");
    if (el) el.innerHTML = html;
    // ensure floating details visible when using the float body
    const float = document.getElementById("onxFloatDetails");
    if (float && el && el.id === "onxFloatDetailsBody") {
      float.style.display = "block";
    }
  }

  function renderPropertiesSection(ifcProps) {
    if (!ifcProps || typeof ifcProps !== "object") return "";
    let out = `<div style='margin-top:8px;font-size:13px;font-weight:700;'>Properties</div>`;
    out += `<div style='font-size:12px;color:var(--text-muted);max-height:280px;overflow:auto;border:1px solid var(--stroke);padding:6px;border-radius:8px;margin-top:6px;'>`;
    for (const [pset, props] of Object.entries(ifcProps)) {
      out += `<div style='margin-bottom:8px;'><div style='font-weight:600;margin-bottom:4px;'>${pset}</div>`;
      out += `<div style='font-size:12px;color:var(--text-main);margin-left:6px;'>`;
      for (const [k, v] of Object.entries(props)) {
        const safeV = (v === null || v === undefined || v === "") ? "—" : String(v);
        out += `<div style='display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px dashed rgba(0,0,0,0.03)'><div style='flex:1;color:var(--text-muted)'>${k}</div><div style='flex:1;text-align:right'>${safeV}</div></div>`;
      }
      out += `</div></div>`;
    }
    out += `</div>`;
    return out;
  }

  function updateDetailsForNode(node) {
    const d = node.data();
    let html = `<div style='font-size:14px;font-weight:800;margin-bottom:6px;'>${d.displayLabel ?? d.id}</div>`;
    html += `<div style='font-size:13px;margin-bottom:6px;'>Type: ${d.nodeType ?? "-"}</div>`;
    html += `<div style='font-size:13px;margin-bottom:6px;'>Category: ${d.category ?? d.revitCategory ?? "-"}</div>`;
    html += `<div style='font-size:13px;margin-bottom:6px;'>Level: ${d.level ?? "-"}</div>`;

    // IFC properties (if present)
    if (d.ifcProperties) {
      try {
        html += renderPropertiesSection(d.ifcProperties);
      } catch (e) { /* swallow render errors */ }
    }

    setDetailsMessage(html);
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

  // ---- Floating details close hook
  function hookFloatDetailsClose() {
    const btn = document.querySelector("#onxFloatDetails .onx-fd-close") || document.querySelector(".onx-fd-close");
    if (!btn || btn.__hooked) return;
    btn.__hooked = true;
    btn.addEventListener("click", () => {
      const float = document.getElementById("onxFloatDetails");
      if (float) float.style.display = "none";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookFloatDetailsClose);
  else setTimeout(hookFloatDetailsClose, 0);

  // =========================================================
  // ONEXUS LayerMode: registry + state management (core)
  // - Keeps this module as the single source of truth for state.layerMode
  // - Emits: onexus:layerModeChanged via ONEXUS.bus (if present)
  // - Persists in localStorage under "onexus.layerMode"
  // =========================================================
  const LAYERS = (window.ONEXUS_LAYERS = window.ONEXUS_LAYERS || {});

  // Minimal built-ins (extend freely with registerLayerMode)
  LAYERS.relationship ??= {
    key: "relationship",
    title: { en: "Relationship", jp: "関係" },
    // optional hooks:
    // onEnter({ cy, state, prev, next }) {}
    // onExit({ cy, state, prev, next }) {}
  };

  LAYERS.lifecycle ??= {
    key: "lifecycle",
    title: { en: "Lifecycle", jp: "ライフサイクル" },
  };

  LAYERS.risk ??= {
    key: "risk",
    title: { en: "Risk", jp: "リスク" },
  };

  LAYERS.option ??= {
    key: "option",
    title: { en: "Option", jp: "オプション" },
  };

  function normalizeLayerKey(key) {
    const k = String(key ?? "").trim();
    if (!k) return "relationship";
    return LAYERS[k] ? k : "relationship";
  }

  function getLayerMode() {
    return state.layerMode;
  }

  /**
   * Apply layer mode.
   * @param {string} mode
   * @param {{persist?:boolean, silent?:boolean}} opts
   */
  function setLayerMode(mode, opts = {}) {
    const { persist = true, silent = false } = opts;
    const next = normalizeLayerKey(mode);
    const prev = normalizeLayerKey(state.layerMode);

    if (prev === next) return prev;

    const cy = window.cy;
    const prevCfg = LAYERS[prev];
    const nextCfg = LAYERS[next];

    // exit hook (best-effort)
    try { prevCfg?.onExit?.({ cy, state, prev, next }); } catch (e) { console.warn("Layer onExit failed:", e); }

    state.layerMode = next;
    if (persist) safeWrite(LAYER_PREF_KEY, next);

    // enter hook (best-effort)
    try { nextCfg?.onEnter?.({ cy, state, prev, next }); } catch (e) { console.warn("Layer onEnter failed:", e); }

    // emit event (non-breaking)
    try {
      window.ONEXUS?.bus?.emit?.("layerModeChanged", { prev, next, state: window.__onexus_state });
    } catch { }

    // optional UI sync (if select exists)
    if (!silent) {
      const sel = document.getElementById("layerModeSelect");
      if (sel && sel.value !== next) sel.value = next;
      window.showTransientMessage?.(`Layer: ${nextCfg?.title?.[state.language] ?? next}`);
    }

    return next;
  }

  function registerLayerMode(key, config = {}) {
    const k = String(key ?? "").trim();
    if (!k) throw new Error("registerLayerMode: key is required");
    LAYERS[k] = { key: k, ...config };
    return LAYERS[k];
  }

  // expose
  window.getLayerMode = getLayerMode;
  window.setLayerMode = setLayerMode;
  window.registerLayerMode = registerLayerMode;

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