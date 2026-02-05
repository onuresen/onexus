/* ONEXUS – Context: Menu (invokes Link API, Pathfinder, View actions) */
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  let menu;
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div'); menu.id = 'cy-context-menu'; document.body.appendChild(menu);
    Object.assign(menu.style, { position: 'fixed', display: 'none', minWidth: '200px', background: '#fff', color: '#111', border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 6px 14px rgba(0,0,0,0.14)', borderRadius: '6px', padding: '6px 0', zIndex: 10050, fontSize: '13px' });
    const style = document.createElement('style');
    style.textContent = `
#cy-context-menu .cm-item{ padding:8px 12px; cursor:pointer; white-space:nowrap}
#cy-context-menu .cm-item:hover{ background:rgba(0,0,0,0.05)}
#cy-context-menu .cm-divider{ height:1px; margin:6px 0; background:rgba(0,0,0,0.06)}`;
    document.head.appendChild(style);
    return menu;
  }
  function hide() { ensureMenu().style.display = 'none'; }
  function render(items, x, y) {
    const m = ensureMenu();
    m.innerHTML = '';
    items.forEach(it => {
      if (it.type === 'divider') { const d = document.createElement('div'); d.className = 'cm-divider'; m.appendChild(d); return; }
      const el = document.createElement('div'); el.className = 'cm-item'; el.textContent = it.label;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); hide(); try { it.action && it.action(); } catch (e) { console.error('Context menu action failed', e); } });
      m.appendChild(el);
    });
    m.style.display = 'block';
    const rect = m.getBoundingClientRect(); const ww = innerWidth, wh = innerHeight;
    let left = x, top = y;
    if (left + rect.width > ww) left = Math.max(8, ww - rect.width - 8);
    if (top + rect.height > wh) top = Math.max(8, wh - rect.height - 8);
    m.style.left = left + 'px'; m.style.top = top + 'px';
  }

  function itemsForNode(node) {
    const base = [
      { label: 'Focus (1-hop)', action: () => { window.setFocusDepth?.(1); state.focusedNode = node; window.applyDepthFocus?.(node); } },
      { label: 'Focus (2-hop)', action: () => { window.setFocusDepth?.(2); state.focusedNode = node; window.applyDepthFocus?.(node); } },
      { label: 'Center on node', action: () => { if (node && node.nonempty && node.nonempty()) cy.center(node); } },
      {
        label: 'Select (host)', action: () => {
          if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage({ type: 'select-node', id: node.id(), revitInstanceIds: node.data('revitInstanceIds') ?? [], revitInstanceUids: node.data('revitInstanceUids') ?? [] });
          }
        }
      },
      { type: 'divider' },
      {
        label: 'Export node JSON', action: () => {
          const payload = { elements: { nodes: [{ data: node.data() }], edges: [] }, meta: { exportedAt: new Date().toISOString() } };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = node.id() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
      }
    ];

    // Manual relation (link API)
    const linkItems = [{ type: 'divider' }];
    if (!window.__onexusLink?.beginManualLink) {
      // link API missing; skip
    } else {
      const src = window.__onexus_edit?.linkSource;
      if (!src) linkItems.push({ label: 'Start relation from here…', action: () => window.__onexusLink.beginManualLink(node) });
      else if (src.id() === node.id()) linkItems.push({ label: 'Cancel pending link', action: () => window.__onexusLink.cancelManualLink() });
      else linkItems.push(
        { label: 'Connect relation to here…', action: () => window.openEdgeWizard?.(src, node, { mode: 'create' }) },
        { label: 'Cancel pending link', action: () => window.__onexusLink.cancelManualLink() }
      );
    }

    // Pathfinder
    const pathItems = [{ type: 'divider' }];
    if (window.onexusPath?.upstreamFrom) {
      pathItems.push(
        { label: 'Upstream (N-hop)', action: () => window.onexusPath.upstreamFrom(node) },
        { label: 'Downstream (N-hop)', action: () => window.onexusPath.downstreamFrom(node) }
      );
      const chip = document.getElementById('onexus-path-chip');
      if (!chip || chip.style.display === 'none') {
        pathItems.push({ label: 'Start path from here…', action: () => window.onexusPath.beginFrom(node) });
      } else {
        pathItems.push(
          { label: 'Shortest path: source → here', action: () => window.onexusPath.shortestTo(node) },
          { label: 'Cancel path selection', action: () => window.onexusPath.cancel() }
        );
      }
    }

    return base.concat(linkItems).concat(pathItems);
  }

  function itemsForEdge(edge) {
    return [
      { label: 'Edit relation…', action: () => window.openEdgeWizard?.(edge.source(), edge.target(), { mode: 'edit', edge }) },
      { label: 'Reverse direction', action: () => window.__onexusLink?.reverseEdge?.(edge) },
      { type: 'divider' },
      { label: 'Delete edge', action: () => window.__onexusLink?.deleteEdge?.(edge) },
    ];
  }

  // Hook cytoscape events
  cy.on('cxttap', 'node', (evt) => { const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX; const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY; render(itemsForNode(evt.target), ex, ey); });
  cy.on('cxttap', 'edge', (evt) => { const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX; const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY; render(itemsForEdge(evt.target), ex, ey); });
  cy.on('cxttap', (evt) => {
    if (evt.target === cy) {
      const ex = evt.originalEvent ? evt.originalEvent.clientX : window.event.clientX;
      const ey = evt.originalEvent ? evt.originalEvent.clientY : window.event.clientY;
      render([
        { label: 'Fit view', action: window.fitView },
        { label: 'Center view', action: window.centerView },
        { label: 'Reset view', action: window.resetView },
        { type: 'divider' },
        { label: state.showEdgeLabels ? 'Hide edge labels' : 'Show edge labels', action: () => window.setEdgeLabelVisibility?.(!state.showEdgeLabels) },
        { label: state.showNodeLabels ? 'Hide node labels' : 'Show node labels', action: () => window.setNodeLabelVisibility?.(!state.showNodeLabels) },
        { type: 'divider' },
        { label: 'Show all edges', action: window.showAllEdges },
        { label: 'Clear relationship filter', action: window.clearRelationshipFilter },
        { type: 'divider' },
        { label: 'Clear path highlight', action: () => window.onexusPath?.clearHighlight?.() },
      ], ex, ey);
    }
  });

  document.addEventListener('contextmenu', (ev) => { try { const t = ev.target; if (t && t.closest && (t.closest('#cy') || t.closest('#cy-context-menu'))) ev.preventDefault(); } catch { } });
  document.addEventListener('click', hide);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { hide(); window.__onexusLink?.cancelManualLink?.(); } });

  // expose
  window.hideContextMenu = hide;
})();