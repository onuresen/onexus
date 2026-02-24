/* ONEXUS – Context: Menu (invokes Link API, Pathfinder, View actions)
 PATCH: adds Plugin Trace behaviors section.
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  let menu;

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "cy-context-menu";
    document.body.appendChild(menu);
    Object.assign(menu.style, {
      position: "fixed",
      display: "none",
      minWidth: "220px",
      background: "#fff",
      color: "#111",
      border: "1px solid rgba(0,0,0,0.12)",
      boxShadow: "0 6px 14px rgba(0,0,0,0.14)",
      borderRadius: "6px",
      padding: "6px 0",
      zIndex: 10050,
      fontSize: "13px",
    });

    const style = document.createElement("style");
    style.textContent = `
      #cy-context-menu .cm-item{ padding:8px 12px; cursor:pointer; white-space:nowrap}
      #cy-context-menu .cm-item:hover{ background:rgba(0,0,0,0.05)}
      #cy-context-menu .cm-divider{ height:1px; margin:6px 0; background:rgba(0,0,0,0.06)}
    `;
    document.head.appendChild(style);
    return menu;
  }

  function hide() { ensureMenu().style.display = "none"; }

  function render(items, x, y) {
    const m = ensureMenu();
    m.innerHTML = "";
    items.forEach(it => {
      if (it.type === "divider") {
        const d = document.createElement("div");
        d.className = "cm-divider";
        m.appendChild(d);
        return;
      }
      const el = document.createElement("div");
      el.className = "cm-item";
      el.textContent = it.label;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hide();
        try { it.action && it.action(); } catch (e) { console.error("Context menu action failed", e); }
      });
      m.appendChild(el);
    });

    m.style.display = "block";
    const rect = m.getBoundingClientRect();
    const ww = innerWidth, wh = innerHeight;
    let left = x, top = y;
    if (left + rect.width > ww) left = Math.max(8, ww - rect.width - 8);
    if (top + rect.height > wh) top = Math.max(8, wh - rect.height - 8);
    m.style.left = left + "px";
    m.style.top = top + "px";
  }

  function exportNodeJson(node) {
    const payload = {
      elements: { nodes: [{ data: node.data() }], edges: [] },
      meta: { exportedAt: new Date().toISOString() }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = node.id() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ===============================
  // Plugin Trace Support
  // ===============================
  function exists(col) { return !!col && !!col.nonempty && col.nonempty(); }

  function clearTraceHighlight() {
    // Prefer the official clearer if present
    try { window.onexusPath?.clearHighlight?.(); } catch { }
    // Also defensively remove classes (in case a plugin applied them directly)
    try { cy.elements().removeClass("path upstream downstream highlight"); } catch { }
  }

  function applyTraceHighlight(col, mode) {
    clearTraceHighlight();
    if (!col) return;
    try {
      const c = (col && col.nonempty && col.nonempty()) ? col : cy.collection(col);
      if (!exists(c)) return;
      c.addClass("path");
      if (mode === "upstream") c.addClass("upstream");
      else if (mode === "downstream") c.addClass("downstream");
      cy.fit(c, 60);
    } catch (e) {
      console.warn("applyTraceHighlight failed", e);
    }
  }

  // Normalize trace behavior entry:
  // - function(ctx) -> res
  // - { label, run(ctx), mode, when(ctx), order }
  function normalizeTraceEntry(key, val) {
    if (typeof val === "function") {
      return { id: key, label: `Trace: ${key}`, run: val, mode: "path", order: 100 };
    }
    if (val && typeof val === "object") {
      return {
        id: String(key),
        label: val.label || `Trace: ${key}`,
        run: typeof val.run === "function" ? val.run : null,
        mode: val.mode || "path",
        when: typeof val.when === "function" ? val.when : null,
        order: Number.isFinite(val.order) ? val.order : 100,
      };
    }
    return null;
  }

  function handleTraceResult(res, entry) {
    if (!res) return;

    let mode = entry.mode || "path";
    let col = res;

    // Accept: Cytoscape collection OR { collection/elements, mode, message }
    if (res && typeof res === "object" && (res.collection || res.elements)) {
      mode = res.mode || mode;
      col = res.collection || res.elements;
      if (res.message) window.showTransientMessage?.(String(res.message));
    }

    applyTraceHighlight(col, mode);
    window.showTransientMessage?.(entry.label);
  }

  function getPluginTraceItems(node) {
    const map = window.ONEXUS?.plugins?.traceBehaviors;
    if (!map) return [];

    let entries = [];
    try {
      if (map instanceof Map) {
        for (const [k, v] of map.entries()) {
          const e = normalizeTraceEntry(k, v);
          if (e && e.run) entries.push(e);
        }
      } else if (typeof map === "object") {
        for (const k of Object.keys(map)) {
          const e = normalizeTraceEntry(k, map[k]);
          if (e && e.run) entries.push(e);
        }
      }
    } catch (e) {
      console.warn("Trace behaviors read failed", e);
      return [];
    }

    const ctx = {
      cy,
      node,
      state: window.__onexus_state,
      meta: window.__onexus_meta,
      util: window.ONEXUS?.util || {},
      highlight: applyTraceHighlight,
      clear: clearTraceHighlight,
    };

    entries = entries.filter(e => {
      try { return e.when ? !!e.when(ctx) : true; } catch { return false; }
    });

    entries.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));

    return entries.map(e => ({
      label: e.label,
      action: () => {
        let res;
        try { res = e.run(ctx); } catch (err) {
          console.error("Trace run failed:", e.id, err);
          alert("Trace failed: " + (err?.message ?? err));
          return;
        }

        // async support
        if (res && typeof res.then === "function") {
          res.then(r => handleTraceResult(r, e)).catch(err => {
            console.error("Trace async failed:", e.id, err);
            alert("Trace failed: " + (err?.message ?? err));
          });
        } else {
          handleTraceResult(res, e);
        }
      }
    }));
  }

  // ===============================
  // Menu item groups
  // ===============================
  function itemsForNode(node) {
    // ---- Group 1: Edit
    const edit = [
      { label: "Edit node…", action: () => window.openNodeWizard?.({ mode: "edit", node }) },
      { label: "Delete node", action: () => window.ONEXUS_NODES?.deleteNode(node) },
      {
        label: "Duplicate", action: () => {
          const newId = window.ONEXUS_NODES?.duplicateNode(node, { dx: 40, dy: 40, cloneEdges: false });
          if (newId) cy.getElementById(newId).select();
        }
      },
      {
        label: "Duplicate + edges", action: () => {
          const newId = window.ONEXUS_NODES?.duplicateNode(node, { dx: 40, dy: 40, cloneEdges: true });
          if (newId) cy.getElementById(newId).select();
        }
      },
      {
        label: "Duplicate grid 3×2", action: () =>
          window.ONEXUS_NODES?.duplicateNodeGrid(node, { countX: 3, countY: 2, gapX: 120, gapY: 80, cloneEdges: false })
      },
    ];

    // ---- Group 2: View
    const view = [
      { label: "Focus (1-hop)", action: () => { window.setFocusDepth?.(1); state.focusedNode = node; window.applyDepthFocus?.(node); } },
      { label: "Focus (2-hop)", action: () => { window.setFocusDepth?.(2); state.focusedNode = node; window.applyDepthFocus?.(node); } },
      { label: "Center on node", action: () => { if (node?.nonempty?.()) cy.center(node); } },
      {
        label: "Select (host)", action: () => {
          if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage({
              type: "select-node",
              id: node.id(),
              revitInstanceIds: node.data("revitInstanceIds") ?? [],
              revitInstanceUids: node.data("revitInstanceUids") ?? []
            });
          }
        }
      },
    ];

    // ---- Group 3: Connect
    const connect = [];
    const linkApi = window.__onexusLink;
    const src = window.__onexus_edit?.linkSource;
    if (linkApi?.beginManualLink) {
      if (!src) {
        connect.push({ label: "Start relation from here…", action: () => linkApi.beginManualLink(node) });
      } else if (src.id() === node.id()) {
        connect.push({ label: "Cancel pending link", action: () => linkApi.cancelManualLink() });
      } else {
        connect.push(
          { label: "Connect relation to here…", action: () => window.openEdgeWizard?.(src, node, { mode: "create" }) },
          { label: "Cancel pending link", action: () => linkApi.cancelManualLink() }
        );
      }
    }

    // ---- Group 4: Analysis (Path)
    const analysis = [];
    if (window.onexusPath?.upstreamFrom) {
      analysis.push(
        { label: "Upstream (N-hop)", action: () => window.onexusPath.upstreamFrom(node) },
        { label: "Downstream (N-hop)", action: () => window.onexusPath.downstreamFrom(node) }
      );
      const chip = document.getElementById("onexus-path-chip");
      if (!chip || chip.style.display === "none") {
        analysis.push({ label: "Start path from here…", action: () => window.onexusPath.beginFrom(node) });
      } else {
        analysis.push(
          { label: "Shortest path: source → here", action: () => window.onexusPath.shortestTo(node) },
          { label: "Cancel path selection", action: () => window.onexusPath.cancel() }
        );
      }
      analysis.push({ label: "Clear path highlight", action: () => window.onexusPath?.clearHighlight?.() });
    }

    // ---- Group 4.5: Trace (Plugins)
    const pluginTrace = getPluginTraceItems(node);

    // ---- Group 5: Export
    const exportGroup = [
      { label: "Export node JSON", action: () => exportNodeJson(node) }
    ];

    const out = [];
    const addGroup = (g) => {
      if (!g || !g.length) return;
      if (out.length) out.push({ type: "divider" });
      out.push(...g);
    };

    addGroup(edit);
    addGroup(view);
    addGroup(connect);
    addGroup(analysis);
    addGroup(pluginTrace);
    addGroup(exportGroup);

    return out;
  }

  function itemsForEdge(edge) {
    return [
      { label: "Edit relation…", action: () => window.openEdgeWizard?.(edge.source(), edge.target(), { mode: "edit", edge }) },
      { label: "Reverse direction", action: () => window.__onexusLink?.reverseEdge?.(edge) },
      { type: "divider" },
      { label: "Delete edge", action: () => window.__onexusLink?.deleteEdge?.(edge) },
    ];
  }

  // Hook cytoscape events
  cy.on("cxttap", "node", (evt) => {
    const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX;
    const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY;
    render(itemsForNode(evt.target), ex, ey);
  });

  cy.on("cxttap", "edge", (evt) => {
    const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX;
    const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY;
    render(itemsForEdge(evt.target), ex, ey);
  });

  cy.on("cxttap", (evt) => {
    if (evt.target === cy) {
      const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX;
      const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY;
      render([
        { label: "Add node…", action: () => window.openNodeWizard?.({ mode: "create", position: evt.position }) },
        { type: "divider" },
        { label: "Fit view", action: window.fitView },
        { label: "Center view", action: window.centerView },
        { label: "Reset view", action: window.resetView },
        { type: "divider" },
        { label: state.showEdgeLabels ? "Hide edge labels" : "Show edge labels", action: () => window.setEdgeLabelVisibility?.(!state.showEdgeLabels) },
        { label: state.showNodeLabels ? "Hide node labels" : "Show node labels", action: () => window.setNodeLabelVisibility?.(!state.showNodeLabels) },
        { type: "divider" },
        { label: "Show all edges", action: window.showAllEdges },
        { label: "Clear relationship filter", action: window.clearRelationshipFilter },
        { type: "divider" },
        { label: "Clear path highlight", action: () => window.onexusPath?.clearHighlight?.() },
      ], ex, ey);
    }
  });

  document.addEventListener("contextmenu", (ev) => {
    try {
      const t = ev.target;
      if (t && t.closest && (t.closest("#cy") || t.closest("#cy-context-menu"))) ev.preventDefault();
    } catch { }
  });

  document.addEventListener("click", hide);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      hide();
      window.__onexusLink?.cancelManualLink?.();
    }
  });

  // expose
  window.hideContextMenu = hide;
})();