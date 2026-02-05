// ===============================
// ONEXUS – Unified Loader (JSON merge / COBie CSV / ONEXUS-edges CSV / IFC hook)
// Exposes: window.handleUnifiedLoad, window.injectOnexusEdgesCsv
// ===============================

// Minimal CSV line parser (quoted fields with commas/dquotes)
function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { q = false; }
      } else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Choice dialog for ambiguous CSV
function openCsvChoiceDialog() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10060
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#fff', minWidth: '360px', borderRadius: '8px',
      padding: '12px', boxShadow: '0 12px 28px rgba(0,0,0,.22)',
      fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', fontSize: '13px', color: '#111'
    });
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">Choose CSV Type</div>
      <div style="color:#374151;margin-bottom:10px;">We detected CSV input. Select how to import:</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <button id="csv-cobie" class="flat">COBie CSV files (Component/Type/System/Assembly/Space)</button>
        <button id="csv-onexus" class="flat">ONEXUS Edges CSV (from “Export CSV”)</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="csv-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
      </div>`;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const cleanup = () => overlay.remove();
    panel.querySelector('#csv-cancel').addEventListener('click', () => { cleanup(); reject(); });
    panel.querySelector('#csv-cobie').addEventListener('click', () => { cleanup(); resolve('cobie'); });
    panel.querySelector('#csv-onexus').addEventListener('click', () => { cleanup(); resolve('onexus-edges'); });
  });
}

// Merge ONEXUS JSON graphs (nodes by id; edges by tuple)
async function mergeJsonFiles(jsonFiles) {
  const texts = await Promise.all(jsonFiles.map(f => f.text()));
  const graphs = texts.map(t => JSON.parse(t));

  // Normalize minimal node shape (id,nodeType,category,label)
  const normNode = (d) => {
    const out = { ...d };
    out.id = out.id ?? `N_${Math.random().toString(36).slice(2)}`;
    out.nodeType = out.nodeType ?? 'Component';
    out.category = out.category ?? out.revitCategory ?? 'Uncategorized';
    if (typeof out.label !== 'object' || out.label === null) {
      const base = out.displayLabel ?? out.id;
      out.label = { en: String(base), jp: String(base) };
    }
    return out;
  };

  const edgeKey = (d) =>
    `${d.type}\n${d.dimension}\n${d.source}\n${d.target}\n${d.directional ? 1 : 0}`;

  // Merge nodes by id (later files override)
  const nodeMap = new Map();
  for (const g of graphs) {
    for (const n of (g?.elements?.nodes ?? [])) {
      const d = normNode(n?.data ?? {});
      const prev = nodeMap.get(d.id);
      nodeMap.set(d.id, { data: prev ? { ...prev.data, ...d } : { ...d } });
    }
  }

  // Merge edges by tuple (type,dimension,source,target,directional)
  const edgeMap = new Map();
  for (const g of graphs) {
    for (const e of (g?.elements?.edges ?? [])) {
      const raw = e?.data ?? {};
      if (!raw.type || !raw.dimension || !raw.source || !raw.target || typeof raw.directional !== 'boolean') continue;
      const k = edgeKey(raw);
      const prev = edgeMap.get(k);
      edgeMap.set(k, { data: prev ? { ...prev.data, ...raw } : { ...raw } });
    }
  }

  // Ensure unique edge ids
  const usedIds = new Set();
  const edges = [];
  let seq = 0;
  edgeMap.forEach((wrap) => {
    const d = wrap.data;
    let id = d.id && !usedIds.has(d.id) ? d.id : null;
    if (!id) id = `E_${++seq}`;
    usedIds.add(id);
    edges.push({ data: { ...d, id } });
  });
  const nodes = Array.from(nodeMap.values());
  return { elements: { nodes, edges } };
}

// Inject ONEXUS Edges CSV -> build/merge a graph (compatible with exportCSV)
function injectOnexusEdgesCsv(csvText) {
  // Header: id,type,dimension,directional,source,target,phase,owner,risk,confidence,notes
  const lines = String(csvText ?? '').split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() ?? '').split(',');
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const edges = [];
  const nodesSet = new Set();

  for (const L of lines) {
    const cols = parseCsvLine(L);
    const d = (k) => cols[idx[k]] ?? '';
    const source = d('source'), target = d('target');
    if (!source || !target) continue;
    edges.push({
      data: {
        id: d('id') || `e_${source}_${target}_${edges.length + 1}`,
        type: d('type') || 'DependsOn',
        dimension: d('dimension') || 'System',
        directional: d('directional') === '1' || d('directional') === 'true',
        source, target,
        phase: (d('phase') || '').split(/\n/).filter(Boolean),
        owner: d('owner') || '',
        risk: d('risk') || '',
        confidence: d('confidence') || '',
        notes: d('notes') || ''
      }
    });
    nodesSet.add(source); nodesSet.add(target);
  }

  // Create missing nodes if not present
  const cy = window.cy;
  const existingIds = new Set(cy ? cy.nodes().map(n => n.id()) : []);
  const nodes = [];
  for (const id of nodesSet) {
    if (!existingIds.has(id)) {
      nodes.push({
        data: {
          id,
          nodeType: 'Component',
          category: 'Uncategorized',
          label: { en: id, jp: id },
          displayLabel: id
        }
      });
    }
  }
  const graph = { elements: { nodes, edges } };

  if (typeof window.onexusLoadGraph === 'function') {
    window.onexusLoadGraph(graph);
  } else if (cy) {
    cy.elements().remove();
    cy.add(graph.elements.nodes);
    cy.add(graph.elements.edges);
    window.setLanguage?.('en');
    window.buildCategoryFilter?.();
    window.applyLayout?.('default');
    cy.fit(undefined, 50);
  }
}

// Unified loader for .json, .csv, .ifc (public)
async function handleUnifiedLoad(event) {
  const files = Array.from(event?.target?.files ?? []);
  if (!files.length) return;

  const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
  const ifcFiles = files.filter(f => f.name.toLowerCase().endsWith('.ifc'));

  // JSON: single -> normal, >=2 -> merge then load
  if (jsonFiles.length === 1) {
    const evt = { target: { files: [jsonFiles[0]] } };
    window.loadJSON?.(evt); // core IO loader validates and rebuilds UI bits
  } else if (jsonFiles.length >= 2) {
    try {
      const merged = await mergeJsonFiles(jsonFiles);
      window.onexusLoadGraph?.(merged); // core loader (state, filters, layout)
    } catch (err) {
      alert('Failed to merge JSON files: ' + (err?.message ?? err));
    }
  }

  // IFC: pass entire selection to importer hook
  if (ifcFiles.length) {
    return window.ONEXUS_IFC?.loadIFC(event);
  }

  // CSV: decide COBie vs ONEXUS-Edges
  if (!csvFiles.length) return;
  const first = csvFiles[0];
  const text = await first.text().catch(() => '');
  const head = String(text).split(/\r?\n/, 1)[0].toLowerCase();
  if (head.includes('id,type,dimension,directional,source,target')) {
    injectOnexusEdgesCsv(text);
    return;
  }
  // Possibly COBie: forward all CSVs
  if (/\b(component|type|system|assembly|space)\.csv$/i.test(first.name)) {
    window.loadCOBieCSVs?.({ target: { files: csvFiles } });
    return;
  }
  // Ambiguous: ask user
  openCsvChoiceDialog()
    .then(choice => {
      if (choice === 'cobie') {
        window.loadCOBieCSVs?.({ target: { files: csvFiles } });
      } else if (choice === 'onexus-edges') {
        injectOnexusEdgesCsv(text);
      }
    })
    .catch(() => { /* cancelled */ });
}

// Expose
window.handleUnifiedLoad = handleUnifiedLoad;
window.injectOnexusEdgesCsv = injectOnexusEdgesCsv;