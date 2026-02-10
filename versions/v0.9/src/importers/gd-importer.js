/* ONEXUS – Generative Design Importer (overlay / materialize-edges)
   Usage:
     IMPORT_GD.importFromFile(event, { mode: 'overlay'|'materialize-edges', optionId?: 'opt-...' })
     IMPORT_GD.importFromPayload(payload, { mode, optionId })
   Notes:
     - Non-invasive: augments current graph held by window.cy.
     - Host bridge: listens to WebView2 messages { type: 'onexus-gd-import', payload, mode, optionId }.
*/
(function () {
  const cy = window.cy; // ONEXUS Cytoscape instance (booted in graph-core.state.js)  // [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.state.js)

  // ---------- utils ----------
  const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
  const exists = (col) => !!col && !!col.nonempty && col.nonempty();
  const nowIso = () => new Date().toISOString();
  const pick = (obj, keys) => keys.reduce((a, k) => { if (k in obj) a[k] = obj[k]; return a; }, {});

  function chooseOption(payload, optionId) {
    const opts = Array.isArray(payload?.options) ? payload.options : [];
    if (!opts.length) throw new Error('GD payload has no options[]');
    if (optionId) {
      const found = opts.find(o => String(o.id) === String(optionId));
      if (!found) throw new Error(`Option '${optionId}' not found`);
      return found;
    }
    // 1) rank==1, 2) first pareto==true, 3) first item
    const byRank1 = opts.find(o => o.rank === 1);
    if (byRank1) return byRank1;
    const pareto = opts.find(o => o.pareto === true);
    return pareto || opts[0];
  }

  function normalizePayload(payload) {
    if (!payload || (payload.type && payload.type !== 'onexus/generative-design')) {
      // still accept "raw" objects if they look like GD
      if (!payload?.options) throw new Error('Not a GD payload (missing options)');
    }
    return payload;
  }

  function ensureNode(id, seed = {}) {
    let n = cy.getElementById(id);
    if (!exists(n)) {
      n = cy.add({ data: { id, nodeType: seed.nodeType || 'Component', category: seed.category || 'Uncategorized', label: seed.label || { en: id }, displayLabel: seed.displayLabel || id } });
    }
    return n;
  }

  function ensureEdgeId(base) {
    let i = 1; let id = base;
    while (exists(cy.getElementById(id))) { id = `${base}-${++i}`; }
    return id;
  }

  function updateUiAfterMutation() {
    // Re-run legend/filters/metrics; keep language mapping intact
    const lang = window.__onexus_state?.language || 'en';                                 // [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.state.js)
    window.setLanguage?.(lang);                                                          // [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.state.js)
    window.buildCategoryFilter?.(); window.buildPhaseFilter?.();                         // [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.filters.js)
    window.buildRelationshipLegend?.(); window.updateMetrics?.();                        // [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.filters.js)
  }

  // ---------- overlay mode ----------
  function overlayOptionOnGraph(payload, option) {
    const probId = payload?.problem?.id || 'GD';
    const optId = option.id;
    const mark = { problemId: probId, optionId: optId, when: nowIso(), type: 'overlay' };

    // nodes
    const nodes = option?.affected?.nodes || [];
    nodes.forEach(n => {
      const node = ensureNode(n.id);
      const d = clone(node.data());
      // pack GD data under d.gd (append/merge)
      d.gd = d.gd || {};
      d.gd[optId] = {
        scores: clone(option.scores || {}),
        parameters: clone(option.parameters || {}),
        metrics: clone(n.metrics || {}),
        constraintsEval: clone(option.constraintsEval || {}),
        mark
      };
      node.data(d);
    });

    // edges (optional overlay to existing)
    const eitems = option?.affected?.edges || [];
    eitems.forEach(e => {
      // overlay: attach to existing edge if present (id or tuple); else skip
      let hit = null;
      if (e.id) {
        const col = cy.getElementById(e.id);
        if (exists(col)) hit = col;
      }
      if (!hit) {
        const fwd = cy.edges().filter(x => x.data('source') === e.source && x.data('target') === e.target);
        if (fwd.length) hit = fwd[0];
      }
      if (!hit) return; // overlay mode does not materialize new edges
      const d = clone(hit.data());
      d.gd = d.gd || {};
      d.gd[optId] = {
        scores: clone(option.scores || {}),
        parameters: clone(option.parameters || {}),
        metrics: clone(e.metrics || {}),
        constraintsEval: clone(option.constraintsEval || {}),
        mark
      };
      hit.data(d);
    });

    updateUiAfterMutation();
    window.showTransientMessage?.(`GD overlay applied: ${probId} / ${optId}`);           // [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.state.js)
  }

  // ---------- materialize-edges mode ----------
  function materializeOptionToGraph(payload, option) {
    const prob = payload?.problem?.id || 'GD';
    const opt = String(option.id);
    const optNodeId = `GDOPT_${prob}_${opt}`;

    // Ensure Option node
    const optNode = ensureNode(optNodeId, {
      nodeType: 'Option',
      category: 'DesignOption',
      label: { en: `Option ${opt}` },
      displayLabel: `Option ${opt}`
    });

    // Attach scores/params to option node
    const d0 = clone(optNode.data());
    d0.gd = d0.gd || {};
    d0.gd.meta = { problemId: prob, optionId: opt, scores: clone(option.scores || {}), parameters: clone(option.parameters || {}), createdAt: option.createdAt || nowIso() };
    optNode.data(d0);

    // Materialize edges: Option -> affected.nodes (type: Optimizes)
    const nodes = option?.affected?.nodes || [];
    nodes.forEach(n => {
      const target = ensureNode(n.id);
      const eid = ensureEdgeId(`e_${optNodeId}_Optimizes_${target.id()}`);
      cy.add({
        data: {
          id: eid, type: 'Optimizes', dimension: 'System', directional: true,
          source: optNodeId, target: target.id(),
          notes: `metrics=${JSON.stringify(n.metrics || {})}`
        }
      });
    });

    // Materialize any domain edges from GD (if provided)
    const eitems = option?.affected?.edges || [];
    eitems.forEach(e => {
      // ensure endpoints
      ensureNode(e.source); ensureNode(e.target);
      const base = `e_${e.source}_${e.type || 'RelatedTo'}_${e.target}`;
      const id = ensureEdgeId(base);
      cy.add({
        data: {
          id,
          type: e.type || 'RelatedTo',
          dimension: e.dimension || 'System',
          directional: !!e.directional,
          source: e.source,
          target: e.target,
          notes: e.metrics ? `metrics=${JSON.stringify(e.metrics)}` : ''
        }
      });
    });

    updateUiAfterMutation();
    window.showTransientMessage?.(`GD materialized: ${prob} / ${opt}`);                  // [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.state.js)
  }

  // ---------- public API ----------
  async function importFromFile(event, { mode = 'overlay', optionId = null } = {}) {
    const file = event?.target?.files?.[0]; if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text);
    return importFromPayload(payload, { mode, optionId });
  }

  function importFromPayload(payload, { mode = 'overlay', optionId = null } = {}) {
    const P = normalizePayload(payload);
    const opt = chooseOption(P, optionId);
    if (mode === 'materialize-edges') materializeOptionToGraph(P, opt);
    else overlayOptionOnGraph(P, opt);
  }

  // ---------- host bridge (WebView2) ----------
  // Pattern aligns with existing onexusLoadGraph/bridge usage in IO host.         // [2](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.io.host.js)
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e) => {
      const msg = e?.data; if (!msg || !msg.type) return;
      if (msg.type === 'onexus-gd-import') {
        try { importFromPayload(msg.payload, { mode: msg.mode || 'overlay', optionId: msg.optionId || null }); }
        catch (err) { alert('GD import failed: ' + err.message); }
      }
    });
  }

  // expose
  window.IMPORT_GD = {
    importFromFile,
    importFromPayload,
    overlayOptionOnGraph,
    materializeOptionToGraph
  };

})();