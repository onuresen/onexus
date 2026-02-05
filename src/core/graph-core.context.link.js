/* ONEXUS – Context: Manual Relation Editing (Link Wizard API) */
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
    if (confirm('Delete this edge?')) {
      cy.remove(edge);
      window.buildRelationshipLegend?.(); window.updateMetrics?.(); window.setDetailsMessage?.('Edge deleted.');
    }
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

  // expose for menu & taps in state module
  window.openEdgeWizard = openEdgeWizard;
  window.__onexusLink = { beginManualLink, cancelManualLink, deleteEdge, reverseEdge };
})();