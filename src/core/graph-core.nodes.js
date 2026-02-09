/* ONEXUS – Nodes (Create/Edit/Delete + Wizard)
   Safe standalone module. Does not touch edge modules.
   Depends on: cy, __onexus_state, ONEXUS_UNDO (optional), i18n/state helpers. */

(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  // ---------- helpers ----------
  function uniqueNodeId(base) {
    let id = base || ('N_' + Math.random().toString(36).slice(2, 8));
    let k = 1;
    while (cy.getElementById(id)?.nonempty?.()) id = `${base}-${++k}`;
    return id;
  }

  function normLabel(labelOrDisplay, id) {
    const en = String(labelOrDisplay ?? id ?? '').trim() || String(id ?? '');
    return { en, jp: en };
  }

  function displayLabelFor(label) {
    const lang = state?.language ?? 'en';
    return (label && (label[lang] ?? label['en'])) ?? '';
  }

  function buildDefaultNode(template = {}) {
    const id = template.id ?? uniqueNodeId('N');
    const nodeType = template.nodeType ?? 'Component';
    const category = template.category ?? template.revitCategory ?? 'Uncategorized';
    const label =
      (template.label && typeof template.label === 'object')
        ? template.label
        : normLabel(template.displayLabel ?? template.id ?? id, id);

    return {
      id,
      nodeType,
      category,
      label,
      displayLabel: displayLabelFor(label),
      ...template
    };
  }

  function refreshUIAfterNode(n /* optional */) {
    window.buildCategoryFilter?.();   // refresh category selector/contents
    window.updateMetrics?.();         // recompute stats
    if (n?.nonempty?.()) window.updateDetailsForNode?.(n);
  }

  // ---------- thin mutation wrappers with Undo fallback ----------
  function doAddNode(data) {
    // Prefer Undo action if present
    if (window.ONEXUS_UNDO?.actions?.addNode) {
      window.ONEXUS_UNDO.do(window.ONEXUS_UNDO.actions.addNode(data));
    } else {
      const n = cy.add({ data });
      const lang = state?.language ?? 'en';
      const lbl = n.data('label');
      n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
      refreshUIAfterNode(n);
      window.showTransientMessage?.('Added (no-undo fallback).');
    }
  }
  function doEditNode(id, before, patch) {
    if (window.ONEXUS_UNDO?.actions?.editNode) {
      window.ONEXUS_UNDO.do(window.ONEXUS_UNDO.actions.editNode(id, before, patch));
    } else {
      const n = cy.getElementById(id);
      if (!n?.nonempty?.()) return;
      n.data({ ...n.data(), ...patch, id });
      const lang = state?.language ?? 'en';
      const lbl = n.data('label');
      n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
      refreshUIAfterNode(n);
      window.showTransientMessage?.('Updated (no-undo fallback).');
    }
  }
  function doRemoveNode(id, nodeData, incidentEdges) {
    if (window.ONEXUS_UNDO?.actions?.removeNode) {
      window.ONEXUS_UNDO.do(window.ONEXUS_UNDO.actions.removeNode(id, nodeData, incidentEdges));
    } else {
      const n = cy.getElementById(id);
      if (n?.nonempty?.()) cy.remove(n);
      refreshUIAfterNode();
      window.showTransientMessage?.('Deleted (no-undo fallback).');
    }
  }

  // ---------- public API ----------
  function createNode(template = {}, position /* {x,y} optional model coords */) {
    const data = buildDefaultNode(template);
    doAddNode(data);
    // Position after creation (position is not undo-tracked; simple and safe)
    const n = cy.getElementById(data.id);
    if (n?.nonempty?.() && position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      n.position(position);
    }
    window.showTransientMessage?.(`Node added: ${data.displayLabel} (Undo: Ctrl/Cmd+Z)`);
    return data.id;
  }

  function deleteNode(nodeOrId) {
    const n = typeof nodeOrId === 'string' ? cy.getElementById(nodeOrId) : nodeOrId;
    if (!n?.nonempty?.()) return;
    const d = { ...n.data() };
    const inc = n.connectedEdges().map(e => ({ ...e.data() })); // for undo restore
    doRemoveNode(d.id, d, inc);
    window.showTransientMessage?.('Node deleted. (Undo: Ctrl/Cmd+Z)');
  }

  function editNode(nodeOrId, patch) {
    const n = typeof nodeOrId === 'string' ? cy.getElementById(nodeOrId) : nodeOrId;
    if (!n?.nonempty?.()) return;
    const before = { ...n.data() };
    const afterPatch = { ...patch };
    // Ensure label object if caller passed plain displayLabel
    if (afterPatch.displayLabel && !afterPatch.label) {
      afterPatch.label = { ...(before.label ?? {}), en: String(afterPatch.displayLabel), jp: String(afterPatch.displayLabel) };
    }
    // Keep displayLabel aligned to current language if label provided
    if (afterPatch.label) {
      afterPatch.displayLabel = displayLabelFor(afterPatch.label);
    }
    doEditNode(before.id, before, afterPatch);
    window.showTransientMessage?.('Node updated. (Undo: Ctrl/Cmd+Z)');
  }

  // ---------- Node Wizard ----------
  function listNodeTypes() {
    const seen = new Set(cy.nodes().map(n => n.data('nodeType')).filter(Boolean));
    ['Component', 'System', 'Space', 'Organization', 'Vendor', 'ComponentType',
      'PropertySet', 'Port', 'Zone', 'Type', 'Building', 'Storey'].forEach(t => seen.add(t));
    return [...seen].sort();
  }
  function listCategories() {
    const cats = new Set(
      cy.nodes().map(n => n.data('category') ?? n.data('revitCategory')).filter(Boolean)
    );
    if (!cats.size) cats.add('Uncategorized');
    return [...cats].sort();
  }

  function renderPanel({ title, mode, preset }) {
    const types = listNodeTypes();
    const cats = listCategories();

    const idVal = preset.id ?? '';
    const typeVal = preset.nodeType ?? (types[0] || 'Component');
    const catVal = preset.category ?? preset.revitCategory ?? 'Uncategorized';
    const lblEN = (preset.label?.en) ?? (preset.displayLabel ?? preset.id ?? '');
    const lblJP = (preset.label?.jp) ?? (preset.displayLabel ?? preset.id ?? '');
    const level = preset.level ?? '';

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#fff', minWidth: '380px', maxWidth: '460px',
      borderRadius: '8px', padding: '12px',
      boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
      fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      fontSize: '13px', color: '#111'
    });

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">${title}</div>
      <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:8px;">
        <label>Id
          <input id="nw-id" type="text" placeholder="auto if blank" style="width:100%;margin-top:4px;" value="${mode === 'edit' ? idVal : ''}">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label>Type
            <select id="nw-type" style="width:100%;margin-top:4px;">
              ${types.map(t => `<option value="${t}" ${t === typeVal ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
          <label>Category
            <select id="nw-cat" style="width:100%;margin-top:4px;">
              ${cats.map(c => `<option value="${c}" ${c === catVal ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label>Label (en)
            <input id="nw-lbl-en" type="text" style="width:100%;margin-top:4px;" value="${lblEN}">
          </label>
          <label>Label (jp)
            <input id="nw-lbl-jp" type="text" style="width:100%;margin-top:4px;" value="${lblJP}">
          </label>
        </div>
        <label>Level (optional)
          <input id="nw-level" type="text" style="width:100%;margin-top:4px;" value="${level}">
        </label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="nw-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        <button id="nw-apply"  style="padding:6px 10px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer;">${mode === 'edit' ? 'Save' : 'Create'}</button>
      </div>
    `;
    return panel;
  }

  function openNodeWizard(opts = { mode: 'create' }) {
    const mode = opts.mode === 'edit' ? 'edit' : 'create';
    const node = opts.node ?? null;
    const preset = node?.data?.() ?? {};

    let overlay = document.getElementById('onexus-node-wizard');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'onexus-node-wizard';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10060
      });
      document.body.appendChild(overlay);
    }

    const panel = renderPanel({ title: mode === 'edit' ? 'Edit node' : 'Create node', mode, preset });
    overlay.innerHTML = ''; overlay.appendChild(panel);

    const $id = panel.querySelector('#nw-id');
    const $type = panel.querySelector('#nw-type');
    const $cat = panel.querySelector('#nw-cat');
    const $en = panel.querySelector('#nw-lbl-en');
    const $jp = panel.querySelector('#nw-lbl-jp');
    const $level = panel.querySelector('#nw-level');
    const $cancel = panel.querySelector('#nw-cancel');
    const $apply = panel.querySelector('#nw-apply');

    // Optional mirror: if both equal, keep them in sync until diverged
    let lockMirror = ($en.value || '') === ($jp.value || '');
    $en.addEventListener('input', () => { if (lockMirror) $jp.value = $en.value; });
    $jp.addEventListener('input', () => { lockMirror = ($en.value || '') === ($jp.value || ''); });

    const close = () => overlay.remove();
    $cancel.addEventListener('click', close);
    document.addEventListener('keydown', function escOnce(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escOnce); }
    });

    $apply.addEventListener('click', () => {
      const idRaw = ($id.value ?? '').trim();
      const nodeId = (mode === 'edit') ? (preset.id) : (idRaw || uniqueNodeId('N'));
      const nodeType = $type.value;
      const category = $cat.value || 'Uncategorized';
      const label = { en: ($en.value ?? '').trim() || nodeId, jp: ($jp.value ?? '').trim() || ($en.value ?? '').trim() || nodeId };
      const displayLabel = displayLabelFor(label);
      const level = ($level.value ?? '').trim();

      if (!nodeType) { alert('Node type is required.'); return; }
      if (mode === 'create' && cy.getElementById(nodeId)?.nonempty?.()) {
        alert('Id already exists. Please choose another id.'); return;
      }

      if (mode === 'edit') {
        const before = node.data();
        const patch = { id: before.id, nodeType, category, label, displayLabel, level };
        doEditNode(before.id, before, patch);
        window.showTransientMessage?.('Node updated. (Undo: Ctrl/Cmd+Z)');
        close(); return;
      }

      // create
      const data = { id: nodeId, nodeType, category, label, displayLabel, level };
      createNode(data, opts.position);
      close();
    });
  }

  // ===== Fast duplicate helpers =====

  // Make a unique id derived from base with suffixes (id, id-2, id-3 …)
  function uniqueFrom(base) {
    const safe = String(base || 'N').replace(/\s+/g, '_');
    let id = safe;
    let k = 1;
    while (cy.getElementById(id)?.nonempty?.()) id = `${safe}-${++k}`;
    return id;
  }

  // Duplicate a single node (optionally offset, optionally clone incident edges)
  // opts: { dx, dy, cloneEdges, edgeFilter }
  //  - dx,dy: model coords offset (default 40, 40)
  //  - cloneEdges: boolean (default false) -> copy edges where source OR target is source node
  //  - edgeFilter: fn(eData) -> boolean for additional filtering (optional)
  function duplicateNode(sourceNodeOrId, opts = {}) {
    const src = (typeof sourceNodeOrId === 'string') ? cy.getElementById(sourceNodeOrId) : sourceNodeOrId;
    if (!src?.nonempty?.()) return null;

    const dx = Number.isFinite(opts.dx) ? opts.dx : 40;
    const dy = Number.isFinite(opts.dy) ? opts.dy : 40;
    const p0 = src.position();

    // Data copy (shallow copy is enough for our simple shape, but keep label object)
    const sd = { ...src.data() };
    const newId = uniqueFrom(sd.id);
    const newLabel = { ...(sd.label ?? { en: sd.displayLabel ?? newId, jp: sd.displayLabel ?? newId }) };

    const nd = {
      ...sd,
      id: newId,
      label: newLabel,
      displayLabel: (state?.language === 'jp') ? (newLabel.jp ?? newLabel.en ?? newId) : (newLabel.en ?? newId)
    };

    // Add node with Undo if available, without relying on position in the action
    doAddNode(nd);
    const n = cy.getElementById(newId);
    if (n?.nonempty?.()) {
      n.position({ x: p0.x + dx, y: p0.y + dy });
    }

    // Optional: clone incident edges
    if (opts.cloneEdges) {
      const filterFn = typeof opts.edgeFilter === 'function' ? opts.edgeFilter : (() => true);
      const inc = src.connectedEdges();
      inc.forEach(e => {
        const ed = { ...e.data() };
        if (!filterFn(ed)) return;

        let copy = { ...ed, id: undefined }; // id will be generated by uniqueEdgeId in edge module if using wizard;
        // We won’t call the edge wizard here (no UI). We directly add edges via Undo with safe ids.

        // Endpoints: if src was source, wire new node as source; if src was target, wire new node as target
        if (ed.source === sd.id) copy.source = newId;
        if (ed.target === sd.id) copy.target = newId;

        // Skip self-loop duplicates that would re-point both ends to the new node
        if (copy.source === copy.target) return;

        // Generate an id similar to your edge add pattern (e_{src}_{type}_{tgt}[...])
        const base = `e_${copy.source}_${copy.type}_${copy.target}`;
        let eid = base; let k = 1;
        while (cy.getElementById(eid)?.nonempty?.()) eid = `${base}-${++k}`;
        copy.id = eid;

        // Add via UNDO if present (and set displayType like other edge actions do)
        if (window.ONEXUS_UNDO?.actions?.addEdge) {
          window.ONEXUS_UNDO.do(window.ONEXUS_UNDO.actions.addEdge(copy));
        } else {
          const added = cy.add({ data: copy });
          // emulate setLanguage behavior for edge displayType
          const map = (window.__onexus_labels?.[state?.language] ?? {});
          added.data('displayType', map[added.data('type')] ?? added.data('type'));
          added.style('text-opacity', state?.showEdgeLabels ? 1 : 0);
        }
      });
      window.buildRelationshipLegend?.(); // reflect new edge types
      window.updateMetrics?.();
    }

    return newId;
  }

  // Duplicate many times into a grid (fast content staging)
  // countX,countY: counts along X and Y; gapX,gapY: offsets in model coords
  // cloneEdges: copy only edges that connect to the source node (each clone rewires those edges to itself)
  function duplicateNodeGrid(sourceNodeOrId, { countX = 3, countY = 2, gapX = 120, gapY = 80, cloneEdges = false } = {}) {
    const src = (typeof sourceNodeOrId === 'string') ? cy.getElementById(sourceNodeOrId) : sourceNodeOrId;
    if (!src?.nonempty?.()) return [];

    const ids = [];
    for (let j = 0; j < countY; j++) {
      for (let i = 0; i < countX; i++) {
        const dx = i * gapX;
        const dy = j * gapY;
        const id = duplicateNode(src, { dx, dy, cloneEdges });
        if (id) ids.push(id);
      }
    }
    if (ids.length) cy.fit(cy.collection(ids.map(id => cy.getElementById(id))), 60);
    return ids;
  }

  // ---- Export in the module API (safe init & extend) ----
  window.ONEXUS_NODES = window.ONEXUS_NODES || {};

  // attach all functions without overwriting the object
  window.ONEXUS_NODES.createNode = createNode;
  window.ONEXUS_NODES.editNode = editNode;
  window.ONEXUS_NODES.deleteNode = deleteNode;
  window.ONEXUS_NODES.duplicateNode = duplicateNode;
  window.ONEXUS_NODES.duplicateNodeGrid = duplicateNodeGrid;

  // expose wizard entry point
  window.openNodeWizard = openNodeWizard;
})();