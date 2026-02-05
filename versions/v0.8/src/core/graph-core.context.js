/* ONEXUS – Context Menu & Manual Relation Editing */

(function () {
  const cy = window.cy;
  const state = window.__onexus_state;
  const editState = window.__onexus_edit;
  const LABELS = window.__onexus_labels;
  const DIMENSION_DEFAULTS = window.__onexus_dims;

  function ensureLinkChip() {
    let chip = document.getElementById('onexus-link-chip');
    if (chip) return chip;
    const toolbar = document.getElementById('toolbar'); if (!toolbar) return null;
    chip = document.createElement('div'); chip.id = 'onexus-link-chip';
    Object.assign(chip.style, { display: 'none', marginLeft: '8px', padding: '4px 8px', border: '1px solid var(--stroke)', borderRadius: '999px', background: 'var(--bg-soft)', color: 'var(--text-main)', fontSize: '12px', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', userSelect: 'none' });
    const text = document.createElement('span'); text.id = 'onexus-link-chip-text';
    const btn = document.createElement('button'); btn.textContent = 'Cancel';
    Object.assign(btn.style, { marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', border: '1px solid var(--stroke)', background: 'var(--btn-bg)', cursor: 'pointer', fontSize: '12px' });
    btn.addEventListener('click', () => cancelManualLink());
    chip.appendChild(text); chip.appendChild(btn); toolbar.appendChild(chip);
    return chip;
  }
  function updateLinkChip() {
    const chip = ensureLinkChip(); if (!chip) return;
    const text = document.getElementById('onexus-link-chip-text');
    if (editState.linkSource) { chip.style.display = 'flex'; text.textContent = `Linking from: ${editState.linkSource.data('displayLabel') ?? editState.linkSource.id()}`; }
    else { chip.style.display = 'none'; }
  }
  function beginManualLink(node) { cancelManualLink(); editState.linkSource = node; node.addClass('highlight'); updateLinkChip(); window.showTransientMessage?.('Pick a target node to connect…'); }
  function cancelManualLink() { if (editState.linkSource) editState.linkSource.removeClass('highlight'); editState.linkSource = null; updateLinkChip(); }

  function deleteEdge(edge) {
    if (!edge || !edge.nonempty || !edge.nonempty()) return;
    if (confirm('Delete this edge?')) { cy.remove(edge); window.buildRelationshipLegend?.(); window.updateMetrics?.(); window.setDetailsMessage?.('Edge deleted.'); }
  }
  function reverseEdge(edge) {
    if (!edge || !edge.nonempty || !edge.nonempty()) return;
    const d = { ...edge.data() };
    const newData = { ...d, source: d.target, target: d.source };
    const keepId = d.id;
    edge.remove();
    const e2 = cy.add({ data: newData });
    e2.data('id', keepId);
    const t = e2.data('type'); e2.data('displayType', (LABELS[state.language] ?? {})[t] ?? t);
    e2.style('text-opacity', state.showEdgeLabels ? 1 : 0);
    window.buildRelationshipLegend?.(); window.updateMetrics?.(); window.updateDetailsForEdge?.(e2);
    window.showTransientMessage?.('Edge direction reversed.');
  }
  function uniqueEdgeId(base) { let id = base, k = 1; const exists = () => { const col = cy.getElementById(id); return col && col.nonempty && col.nonempty(); }; while (exists()) { k += 1; id = `${base}-${k}`; } return id; }

  function openEdgeWizard(sourceNode, targetNode, opts = {}) {
    const mode = opts.mode ?? 'create';
    const existingEdge = opts.edge ?? null;
    const srcId = sourceNode.id(), tgtId = targetNode.id();
    const typeOpts = [...new Set(cy.edges().map(e => e.data('type')))].filter(Boolean);
    const dimOpts = [...new Set(cy.edges().map(e => e.data('dimension')))].filter(Boolean);
    const typeOptions = typeOpts.length ? typeOpts : ["Controls", "Supplies", "LocatedIn", "DesignedBy", "BuiltBy", "ProvidedBy", "PartOfSystem"];
    const dimOptions = dimOpts.length ? dimOpts : DIMENSION_DEFAULTS;
    const defaultDim = (sourceNode.data('nodeType') === 'Space' || targetNode.data('nodeType') === 'Space') ? 'Spatial' : (dimOpts[0] ?? 'System');

    let overlay = document.getElementById('onexus-edge-wizard');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'onexus-edge-wizard';
      Object.assign(overlay.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10060 });
      document.body.appendChild(overlay);
    }
    const panel = document.createElement('div');
    Object.assign(panel.style, { background: '#fff', minWidth: '360px', maxWidth: '440px', borderRadius: '8px', padding: '12px', boxShadow: '0 12px 28px rgba(0,0,0,0.22)', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', fontSize: '13px', color: '#111' });
    const title = mode === 'edit' ? 'Edit relation' : 'Create relation';
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">${title}</div>
      <div style="margin-bottom:6px;"><b>From:</b> ${sourceNode.data('displayLabel') ?? srcId}</div>
      <div style="margin-bottom:10px;"><b>To:</b> ${targetNode.data('displayLabel') ?? tgtId}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <label>Type
          <select id="rel-type" style="width:100%;margin-top:4px;">
            ${typeOptions.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </label>
        <label>Dimension
          <select id="rel-dim" style="width:100%;margin-top:4px;">
            ${dimOptions.map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <input id="rel-dir" type="checkbox" checked> Directional (source → target)
      </label>
      <label style="display:block;margin-bottom:10px;">
        <div style="margin-bottom:4px;">Notes (optional)</div>
        <textarea id="rel-notes" rows="3" style="width:100%;"></textarea>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="rel-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        <button id="rel-apply" style="padding:6px 10px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer;">${mode === 'edit' ? 'Save' : 'Create'}</button>
      </div>`;
    overlay.innerHTML = ''; overlay.appendChild(panel);

    const $type = panel.querySelector('#rel-type'), $dim = panel.querySelector('#rel-dim'), $dir = panel.querySelector('#rel-dir'), $notes = panel.querySelector('#rel-notes');
    if (mode === 'edit' && existingEdge) {
      const d = existingEdge.data();
      if ([...$type.options].some(o => o.value === d.type)) $type.value = d.type;
      if ([...$dim.options].some(o => o.value === d.dimension)) $dim.value = d.dimension; else $dim.value = d.dimension ?? defaultDim;
      $dir.checked = !!d.directional; $notes.value = d.notes ?? "";
    } else { $dim.value = defaultDim; $dir.checked = true; $notes.value = ""; }

    const close = () => { overlay.remove(); cancelManualLink(); };
    panel.querySelector('#rel-cancel').addEventListener('click', close);
    panel.querySelector('#rel-apply').addEventListener('click', () => {
      const type = $type.value, dimension = $dim.value, directional = $dir.checked, notes = $notes.value ?? "";
      if (mode === 'edit' && existingEdge) {
        existingEdge.data({ ...existingEdge.data(), type, dimension, directional: !!directional, notes });
        const t = existingEdge.data('type');
        existingEdge.data('displayType', (LABELS[state.language] ?? {})[t] ?? t);
        existingEdge.style('text-opacity', state.showEdgeLabels ? 1 : 0);
        window.buildRelationshipLegend?.(); window.updateMetrics?.(); window.updateDetailsForEdge?.(existingEdge);
        window.showTransientMessage?.('Relation updated.'); close(); return;
      }
      const dup = cy.edges().filter(e => e.data('source') === srcId && e.data('target') === tgtId && e.data('type') === type);
      if (dup.length > 0) { alert('An identical edge already exists.'); return; }
      const id = uniqueEdgeId(`e_${srcId}_${type}_${tgtId}`);
      const edgeData = { id, type, dimension, directional: !!directional, source: srcId, target: tgtId, notes };
      const edgeEle = cy.add({ data: edgeData });
      const t = edgeData.type; edgeEle.data('displayType', (LABELS[state.language] ?? {})[t] ?? t);
      edgeEle.style('text-opacity', state.showEdgeLabels ? 1 : 0);
      window.buildRelationshipLegend?.(); window.updateMetrics?.(); window.updateDetailsForEdge?.(edgeEle);
      window.showTransientMessage?.(`Added: ${edgeEle.data('displayType')} (${edgeData.source} → ${edgeData.target})`);
      close();
    });
  }

  function createContextMenu() {
    const container = document.getElementById('cy'); if (!container) return;
    let menu = document.getElementById('cy-context-menu');
    if (!menu) {
      menu = document.createElement('div'); menu.id = 'cy-context-menu'; document.body.appendChild(menu);
      Object.assign(menu.style, { position: 'fixed', display: 'none', minWidth: '200px', background: '#fff', color: '#111', border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 6px 14px rgba(0,0,0,0.14)', borderRadius: '6px', padding: '6px 0', zIndex: 10050, fontSize: '13px' });
      const style = document.createElement('style'); style.textContent = `
#cy-context-menu .cm-item{ padding:8px 12px; cursor:pointer; white-space:nowrap}
#cy-context-menu .cm-item:hover{ background:rgba(0,0,0,0.05)}
#cy-context-menu .cm-divider{ height:1px; margin:6px 0; background:rgba(0,0,0,0.06)}`; document.head.appendChild(style);
    }
    function hide() { menu.style.display = 'none'; }
    function render(items, x, y) {
      menu.innerHTML = '';
      items.forEach(it => {
        if (it.type === 'divider') { const d = document.createElement('div'); d.className = 'cm-divider'; menu.appendChild(d); return; }
        const el = document.createElement('div'); el.className = 'cm-item'; el.textContent = it.label;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); hide(); try { it.action && it.action(); } catch (e) { console.error('Context menu action failed', e); } });
        menu.appendChild(el);
      });
      menu.style.display = 'block'; const rect = menu.getBoundingClientRect(); const ww = innerWidth, wh = innerHeight;
      let left = x, top = y; if (left + rect.width > ww) left = Math.max(8, ww - rect.width - 8); if (top + rect.height > wh) top = Math.max(8, wh - rect.height - 8);
      menu.style.left = left + 'px'; menu.style.top = top + 'px';
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

      // existing link (manual relation) items
      const linkItems = [{ type: 'divider' }];
      if (!editState.linkSource) linkItems.push({ label: 'Start relation from here…', action: () => beginManualLink(node) });
      else if (editState.linkSource.id() === node.id()) linkItems.push({ label: 'Cancel pending link', action: () => cancelManualLink() });
      else linkItems.push(
        { label: 'Connect relation to here…', action: () => openEdgeWizard(editState.linkSource, node, { mode: 'create' }) },
        { label: 'Cancel pending link', action: () => cancelManualLink() }
      );

      // NEW: pathfinder items
      const pathItems = [{ type: 'divider' }];
      // Start/Cancel source
      if (!window.onexusPath?.beginFrom) {
        // path module missing; no items
      } else {
        const src = window.__onexus_path_src; // not used; module tracks internally
        if (!window.onexusPath._dummy) { /* placeholder; nothing */ }
        if (!window.onexusPath._noSource && !window.onexusPath._hasSource) { /* we cannot introspect; show generic menu */ }

        // Always offer Up/Downstream
        pathItems.push(
          { label: 'Upstream (N-hop)', action: () => window.onexusPath?.upstreamFrom(node) },
          { label: 'Downstream (N-hop)', action: () => window.onexusPath?.downstreamFrom(node) }
        );

        // Offer path start/complete
        if (!document.getElementById('onexus-path-chip') || document.getElementById('onexus-path-chip').style.display === 'none') {
          pathItems.push({ label: 'Start path from here…', action: () => window.onexusPath?.beginFrom(node) });
        } else {
          pathItems.push(
            { label: 'Shortest path: source → here', action: () => window.onexusPath?.shortestTo(node) },
            { label: 'Cancel path selection', action: () => window.onexusPath?.cancel() }
          );
        }
      }

      return base.concat(linkItems).concat(pathItems);
    }


    function itemsForEdge(edge) {
      return [
        { label: 'Edit relation…', action: () => openEdgeWizard(edge.source(), edge.target(), { mode: 'edit', edge }) },
        { label: 'Reverse direction', action: () => reverseEdge(edge) },
        { type: 'divider' },
        { label: 'Delete edge', action: () => deleteEdge(edge) },
      ];
    }

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
          { label: 'Clear path highlight', action: () => window.onexusPath?.clearHighlight() },
        ], ex, ey);
      }
    });
    document.addEventListener('contextmenu', (ev) => { try { const t = ev.target; if (t && t.closest && (t.closest('#cy') || t.closest('#cy-context-menu'))) ev.preventDefault(); } catch { } });
    document.addEventListener('click', hide);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { hide(); cancelManualLink(); } });

    function hide() { menu.style.display = 'none'; }
    window.hideContextMenu = hide;
  }

  // expose wizard (used by state tap handler)
  window.openEdgeWizard = openEdgeWizard;

  // init
  createContextMenu();
})();