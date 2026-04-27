/* ONEXUS – Nodes (Create/Edit/Delete + Wizard)
   Safe standalone module. Does not touch edge modules.
   Depends on: cy, __onexus_state, ONEXUS_UNDO (optional), i18n/state helpers.
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  // Prefer ONEXUS namespace helpers if present (Option A follow-up)
  const U = window.ONEXUS?.util || {};
  const exists = U.exists || function (col) { return !!col && !!col.nonempty && col.nonempty(); };
  const clone = U.clone || function (x) {
    return (typeof structuredClone === 'function') ? structuredClone(x) : JSON.parse(JSON.stringify(x));
  };
  const idSafe = U.idSafe || function (s) { return String(s ?? '').replace(/[^\w\-:.]+/g, '_'); };
  const esc = U.escapeHtml || function (s) { return String(s ?? '').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); };

  // ---------- helpers ----------
  let _nodeIdSeq = 0;
  function uniqueNodeId(base) {
    let id = base || ('N_' + (++_nodeIdSeq) + '_' + (Date.now() % 100000));
    let k = 1;
    while (exists(cy.getElementById(id))) id = `${base || id}-${++k}`;
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
    window.buildCategoryFilter?.();
    window.updateMetrics?.();
    if (n && exists(n)) window.updateDetailsForNode?.(n);
  }

  // ---------- thin mutation wrappers with Undo fallback ----------
  function doAddNode(data) {
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
      if (!exists(n)) return;
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
      if (exists(n)) cy.remove(n);
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
    if (exists(n) && position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      n.position(position);
    }

    window.showTransientMessage?.(`Node added: ${data.displayLabel} (Undo: Ctrl/Cmd+Z)`);
    return data.id;
  }

  function deleteNode(nodeOrId) {
    const n = (typeof nodeOrId === 'string') ? cy.getElementById(nodeOrId) : nodeOrId;
    if (!exists(n)) return;
    const d = { ...n.data() };
    const inc = n.connectedEdges().map(e => ({ ...e.data() })); // for undo restore
    doRemoveNode(d.id, d, inc);
    window.showTransientMessage?.('Node deleted. (Undo: Ctrl/Cmd+Z)');
  }

  function editNode(nodeOrId, patch) {
    const n = (typeof nodeOrId === 'string') ? cy.getElementById(nodeOrId) : nodeOrId;
    if (!exists(n)) return;
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
      'PropertySet', 'Port', 'Zone', 'Type', 'Building', 'Storey'
    ].forEach(t => seen.add(t));
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
    const typeVal = preset.nodeType ?? (types[0] ?? 'Component');
    const catVal = preset.category ?? preset.revitCategory ?? 'Uncategorized';
    const lblEN = (preset.label?.en) ?? (preset.displayLabel ?? preset.id ?? '');
    const lblJP = (preset.label?.jp) ?? (preset.displayLabel ?? preset.id ?? '');
    const level = preset.level ?? '';

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#fff',
      minWidth: '380px',
      maxWidth: '460px',
      borderRadius: '8px',
      padding: '12px',
      boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
      fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      fontSize: '13px',
      color: '#111'
    });

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">${esc(title)}</div>
      <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:8px;">
        <label>Id
          <input id="nw-id" type="text" placeholder="auto if blank" style="width:100%;margin-top:4px;" value="${mode === 'edit' ? esc(idVal) : ''}">
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label>Type
            <select id="nw-type" style="width:100%;margin-top:4px;">
              ${types.map(t => `<option value="${esc(t)}" ${t === typeVal ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
          </label>

          <label>Category
            <select id="nw-cat" style="width:100%;margin-top:4px;">
              ${cats.map(c => `<option value="${esc(c)}" ${c === catVal ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label>Label (en)
            <input id="nw-lbl-en" type="text" style="width:100%;margin-top:4px;" value="${esc(lblEN)}">
          </label>
          <label>Label (jp)
            <input id="nw-lbl-jp" type="text" style="width:100%;margin-top:4px;" value="${esc(lblJP)}">
          </label>
        </div>

        <label>Level (optional)
          <input id="nw-level" type="text" style="width:100%;margin-top:4px;" value="${esc(level)}">
        </label>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="nw-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        <button id="nw-apply" style="padding:6px 10px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer;">${mode === 'edit' ? 'Save' : 'Create'}</button>
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
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10060
      });
      document.body.appendChild(overlay);
    }

    const panel = renderPanel({ title: mode === 'edit' ? 'Edit node' : 'Create node', mode, preset });
    overlay.innerHTML = '';
    overlay.appendChild(panel);

    const $id = panel.querySelector('#nw-id');
    const $type = panel.querySelector('#nw-type');
    const $cat = panel.querySelector('#nw-cat');
    const $en = panel.querySelector('#nw-lbl-en');
    const $jp = panel.querySelector('#nw-lbl-jp');
    const $level = panel.querySelector('#nw-level');
    const $cancel = panel.querySelector('#nw-cancel');
    const $apply = panel.querySelector('#nw-apply');

    // Optional mirror: if both equal, keep them in sync until diverged
    let lockMirror = ($en.value ?? '') === ($jp.value ?? '');
    $en.addEventListener('input', () => { if (lockMirror) $jp.value = $en.value; });
    $jp.addEventListener('input', () => { lockMirror = ($en.value ?? '') === ($jp.value ?? ''); });

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
      const label = {
        en: ($en.value ?? '').trim() || nodeId,
        jp: ($jp.value ?? '').trim() || (($en.value ?? '').trim() || nodeId)
      };
      const displayLabel = displayLabelFor(label);
      const level = ($level.value ?? '').trim();

      if (!nodeType) { alert('Node type is required.'); return; }
      if (mode === 'create' && exists(cy.getElementById(nodeId))) {
        alert('Id already exists. Please choose another id.'); return;
      }

      if (mode === 'edit') {
        const before = node.data();
        const patch = { id: before.id, nodeType, category, label, displayLabel, level };
        doEditNode(before.id, before, patch);
        window.showTransientMessage?.('Node updated. (Undo: Ctrl/Cmd+Z)');
        close();
        return;
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
    const safe = idSafe(base || 'N');
    let id = safe;
    let k = 1;
    while (exists(cy.getElementById(id))) id = `${safe}-${++k}`;
    return id;
  }

  // Duplicate a single node (optionally offset, optionally clone incident edges)
  // opts: { dx, dy, cloneEdges, edgeFilter }
  function duplicateNode(sourceNodeOrId, opts = {}) {
    const src = (typeof sourceNodeOrId === 'string') ? cy.getElementById(sourceNodeOrId) : sourceNodeOrId;
    if (!exists(src)) return null;

    const dx = Number.isFinite(opts.dx) ? opts.dx : 40;
    const dy = Number.isFinite(opts.dy) ? opts.dy : 40;
    const p0 = src.position();

    const sd = { ...src.data() };
    const newId = uniqueFrom(sd.id);
    const newLabel = { ...(sd.label ?? { en: sd.displayLabel ?? newId, jp: sd.displayLabel ?? newId }) };

    const nd = {
      ...sd,
      id: newId,
      label: newLabel,
      displayLabel: (state?.language === 'jp')
        ? (newLabel.jp ?? newLabel.en ?? newId)
        : (newLabel.en ?? newId)
    };

    doAddNode(nd);

    const n = cy.getElementById(newId);
    if (exists(n)) n.position({ x: p0.x + dx, y: p0.y + dy });

    // Optional: clone incident edges
    if (opts.cloneEdges) {
      const filterFn = (typeof opts.edgeFilter === 'function') ? opts.edgeFilter : (() => true);
      const inc = src.connectedEdges();

      inc.forEach(e => {
        const ed = { ...e.data() };
        if (!filterFn(ed)) return;

        let copy = { ...ed, id: undefined };

        if (ed.source === sd.id) copy.source = newId;
        if (ed.target === sd.id) copy.target = newId;

        if (copy.source === copy.target) return;

        const base = `e_${copy.source}_${copy.type}_${copy.target}`;
        let eid = base;
        let k = 1;
        while (exists(cy.getElementById(eid))) eid = `${base}-${++k}`;
        copy.id = eid;

        if (window.ONEXUS_UNDO?.actions?.addEdge) {
          window.ONEXUS_UNDO.do(window.ONEXUS_UNDO.actions.addEdge(copy));
        } else {
          const added = cy.add({ data: copy });
          const map = (window.__onexus_labels?.[state?.language] ?? {});
          added.data('displayType', map[added.data('type')] ?? added.data('type'));
          added.style('text-opacity', state?.showEdgeLabels ? 1 : 0);
        }
      });

      window.buildRelationshipLegend?.();
      window.updateMetrics?.();
    }

    return newId;
  }

  // Duplicate many times into a grid
  function duplicateNodeGrid(sourceNodeOrId, { countX = 3, countY = 2, gapX = 120, gapY = 80, cloneEdges = false } = {}) {
    const src = (typeof sourceNodeOrId === 'string') ? cy.getElementById(sourceNodeOrId) : sourceNodeOrId;
    if (!exists(src)) return [];

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
  window.ONEXUS_NODES.createNode = createNode;
  window.ONEXUS_NODES.editNode = editNode;
  window.ONEXUS_NODES.deleteNode = deleteNode;
  window.ONEXUS_NODES.duplicateNode = duplicateNode;
  window.ONEXUS_NODES.duplicateNodeGrid = duplicateNodeGrid;

  // expose wizard entry point
  window.openNodeWizard = openNodeWizard;
})();