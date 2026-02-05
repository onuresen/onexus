// ===============================
// ONEXUS – Graph UI Bindings
// ===============================

const readPref = (k, d) => localStorage.getItem(k) ?? d;
const writePref = (k, v) => localStorage.setItem(k, v);
// Helper to attach listener if element exists
const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

// --- CSV classifier (COBie vs ONEXUS export) ---
function classifyCsvText(name, text) {
  const lower = (name || '').toLowerCase();
  // Quick filename hints for COBie sheets
  if (/(component|type|system|assembly|space)\.csv$/.test(lower)) return 'cobie';
  // Peek first line headers
  const head = String(text || '').split(/\r?\n/, 1)[0].toLowerCase();
  // ONEXUS edges CSV has fixed columns from exportCSV()
  if (head.includes('id,type,dimension,directional,source,target')) return 'onexus-edges';
  // COBie sheets typically have headers like "Name,CreatedBy,CreatedOn,TypeName"
  if (/(name|typename|space|floor|createdby)/.test(head)) return 'cobie-maybe';
  return 'unknown';
}

(function () {
  // Toolbar: dropdowns
  on('languageSelect', 'change', e => {
    writePref('onexus.lang', e.target.value);
    window.setLanguage?.(e.target.value);
  });
  on('layoutSelect', 'change', e => {
    writePref('onexus.layout', e.target.value);
    window.applyLayout?.(e.target.value);
  });
  on('themeSelect', 'change', e => {
    writePref('onexus.theme', e.target.value);
    window.applyTheme?.(e.target.value);
  });
  on('fileInput', 'change', e => window.handleUnifiedLoad?.(e));

  // Restore preferences on startup
  window.addEventListener('DOMContentLoaded', () => {
    const lang = readPref('onexus.lang', 'en');
    const theme = readPref('onexus.theme', 'light');
    const layout = readPref('onexus.layout', 'default');
    const $lang = document.getElementById('languageSelect'); if ($lang) $lang.value = lang;
    const $theme = document.getElementById('themeSelect'); if ($theme) $theme.value = theme;
    const $layout = document.getElementById('layoutSelect'); if ($layout) $layout.value = layout;
    window.setLanguage?.(lang);
    window.applyTheme?.(theme);
    window.applyLayout?.(layout);
  });

  // Icon buttons: navigation
  on('btnFit', 'click', () => window.fitView?.());
  on('btnCenter', 'click', () => window.centerView?.());
  on('btnReset', 'click', () => window.resetView?.());

  // Icon buttons: export
  on('btnPng', 'click', () => window.exportPNG?.());
  on('btnSvg', 'click', () => window.exportSVG?.());
  on('btnJson', 'click', () => window.exportJSON?.());
  on('btnCsv', 'click', () => window.exportCSV?.());
  on('btnLayout', 'click', () => window.exportLayout?.());

  // Node search
  on('nodeSearch', 'input', e => {
    const q = (e.target.value || '').toLowerCase().trim();
    const cy = window.cy;
    if (!cy) return;
    cy.elements().removeClass('highlight');
    if (!q) return;
    const hits = cy.nodes().filter(n =>
      n.id().toLowerCase().includes(q) ||
      String(n.data('displayLabel') || '').toLowerCase().includes(q)
    );
    hits.addClass('highlight');
    if (hits.nonempty()) cy.fit(hits, 60);
  });

  // Sidebar: filters
  on('categoryFilter', 'change', e => window.filterByCategory?.(e.target.value));
  on('lensSystem', 'click', () => window.filterByDimension?.('System'));
  on('lensSpatial', 'click', () => window.filterByDimension?.('Spatial'));
  on('lensResp', 'click', () => window.filterByDimension?.('Responsibility'));
  on('lensAll', 'click', () => window.showAllEdges?.());
  on('lensVendor', 'click', () => window.filterByDimension?.('Vendor'));

  // Show / hide edge labels
  on('toggleEdgeLabels', 'change', e =>
    window.setEdgeLabelVisibility?.(e.target.checked)
  );

  on('toggleNodeLabels', 'change', e =>
    window.setNodeLabelVisibility?.(e.target.checked)
  );

  // Focus depth slider
  on('focusRange', 'input', e => window.setFocusDepth?.(e.target.value));

  // Compare (A/B) button opens a dedicated file picker
  on('btnCompare', 'click', () => {
    const inp = document.getElementById('fileCompareAB');
    if (inp) {
      inp.value = ''; // reset selection
      inp.click();
    }
  });

  // Handle two-file selection for compare
  on('fileCompareAB', 'change', (e) => {
    const files = Array.from(e?.target?.files ?? []);
    if (files.length !== 2) {
      alert('Please select exactly two JSON files for A/B compare.');
      return;
    }
    window.ONEXUS_COMPARE?.compareFromFilePair(files[0], files[1]);
  });

  // Keyboard shortcuts (? for help)
  document.addEventListener('keydown', e => {
    const tag = e.target?.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.key === '?') {
      const h = document.getElementById('help');
      if (h) h.style.display = h.style.display === 'flex' ? 'none' : 'flex';
    }
  });

  // Canvas resize
  window.addEventListener('resize', () => window.cy?.resize?.());
})();

// Drag & drop JSON support
(function () {
  const wrap = document.getElementById('canvas-wrap');
  const hint = document.getElementById('drop-hint');
  if (!wrap) return;

  const setHint = (show) => hint && (hint.style.display = show ? 'flex' : 'none');

  wrap.addEventListener('dragenter', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHint(true); });
  wrap.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHint(true); });
  wrap.addEventListener('dragleave', e => { e.preventDefault(); setHint(false); });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    setHint(false);

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;

    // Route the entire file list through the unified loader
    // (handles 1 JSON, 2+ JSON merge, CSV/COBie, IFC)
    window.handleUnifiedLoad?.({ target: { files } });
  });

  // Unified loader for .json and .csv (COBie or ONEXUS edges CSV)
  (function () {
    // Unified loader for .json and .csv (COBie or ONEXUS edges CSV)
    (function () {
      // Unified loader for .json and .csv (COBie or ONEXUS edges CSV)
      (function () {
        async function handleUnifiedLoad(event) {
          const files = Array.from(event?.target?.files ?? []);
          if (!files.length) return;

          // Split by extension first
          const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
          const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
          const ifcFiles = files.filter(f => f.name.toLowerCase().endsWith('.ifc'));

          // --- JSON: 1 => normal, >=2 => merge then load
          if (jsonFiles.length === 1) {
            const evt = { target: { files: [jsonFiles[0]] } };
            window.loadJSON?.(evt); // core loader replaces the graph
          } else if (jsonFiles.length >= 2) {
            try {
              const merged = await mergeJsonFiles(jsonFiles);
              // Use public load entry (validates, rebuilds filters/metrics/layout)
              window.onexusLoadGraph?.(merged);
            } catch (err) {
              alert('Failed to merge JSON files: ' + (err?.message || err));
            }
          }

          // IFC: pass entire selection to importer (unchanged)
          if (ifcFiles.length) {
            return window.ONEXUS_IFC?.loadIFC(event);
          }

          // CSV: decide COBie vs ONEXUS Edges (unchanged)
          if (!csvFiles.length) return;
          const first = csvFiles[0];
          const text = await first.text().catch(() => '');
          const kind = classifyCsvText(first.name, text);

          if (kind === 'onexus-edges') {
            injectOnexusEdgesCsv(text);
            return;
          }
          if (kind === 'cobie') {
            const evt = { target: { files: csvFiles } };
            window.loadCOBieCSVs?.(evt);
            return;
          }

          // Ambiguous: prompt user
          openCsvChoiceDialog()
            .then(choice => {
              if (choice === 'cobie') {
                const evt = { target: { files: csvFiles } };
                window.loadCOBieCSVs?.(evt);
              } else if (choice === 'onexus-edges') {
                injectOnexusEdgesCsv(text);
              }
            })
            .catch(() => { /* cancelled */ });
        }

        // --- MERGE HELPERS (ONEXUS schema) ---
        async function mergeJsonFiles(jsonFiles) {
          const texts = await Promise.all(jsonFiles.map(f => f.text()));
          const graphs = texts.map(t => JSON.parse(t));

          // Normalization helpers for schema compliance
          const normNode = (d) => {
            const out = { ...d };
            out.id = out.id ?? `N_${Math.random().toString(36).slice(2)}`;
            out.nodeType = out.nodeType ?? 'Component';
            out.category = out.category ?? out.revitCategory ?? 'Uncategorized';
            if (typeof out.label !== 'object' || out.label === null) {
              const base = out.displayLabel || out.id;
              out.label = { en: String(base), jp: String(base) };
            }
            return out;
          };
          const edgeKey = (d) =>
            `${d.type}|${d.dimension}|${d.source}|${d.target}|${d.directional ? 1 : 0}`;

          // Merge nodes by id (prefer later files), with normalization
          const nodeMap = new Map();
          for (const g of graphs) {
            for (const n of (g?.elements?.nodes ?? [])) {
              const d = normNode(n?.data || {});
              const prev = nodeMap.get(d.id);
              nodeMap.set(d.id, { data: prev ? { ...prev.data, ...d } : { ...d } });
            }
          }

          // Merge edges by tuple (type, dimension, source, target, directional)
          const edgeMap = new Map();
          for (const g of graphs) {
            for (const e of (g?.elements?.edges ?? [])) {
              const raw = e?.data || {};
              // skip obviously invalid edges early
              if (!raw.type || !raw.dimension || !raw.source || !raw.target || typeof raw.directional !== 'boolean') continue;
              const k = edgeKey(raw);
              const prev = edgeMap.get(k);
              edgeMap.set(k, { data: prev ? { ...prev.data, ...raw } : { ...raw } });
            }
          }

          // Ensure edge ids are unique & present
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

        // Expose
        window.handleUnifiedLoad = handleUnifiedLoad;
      })();

      // --- MERGE HELPERS (ONEXUS schema) ---
      async function mergeJsonFiles(jsonFiles) {
        const texts = await Promise.all(jsonFiles.map(f => f.text()));
        const graphs = texts.map(t => JSON.parse(t));

        // Merge nodes by id (prefer later files); shallow merge of data
        const nodeMap = new Map();
        for (const g of graphs) {
          for (const n of (g?.elements?.nodes ?? [])) {
            const d = n?.data || {};
            if (!d.id) continue;
            const prev = nodeMap.get(d.id);
            nodeMap.set(d.id, { data: prev ? { ...prev.data, ...d } : { ...d } });
          }
        }

        // Merge edges by tuple (type, dimension, source, target, directional)
        const edgeKey = (d) =>
          `${d.type}|${d.dimension}|${d.source}|${d.target}|${d.directional ? 1 : 0}`;
        const edgeMap = new Map();
        for (const g of graphs) {
          for (const e of (g?.elements?.edges ?? [])) {
            const d = e?.data || {};
            if (!d.type || !d.dimension || !d.source || !d.target || typeof d.directional !== 'boolean') continue;
            const k = edgeKey(d);
            const prev = edgeMap.get(k);
            edgeMap.set(k, { data: prev ? { ...prev.data, ...d } : { ...d } });
          }
        }

        // Ensure edge ids are unique and present
        const usedIds = new Set();
        const edges = [];
        let seq = 0;
        edgeMap.forEach((wrap, k) => {
          const d = wrap.data;
          let id = d.id && !usedIds.has(d.id) ? d.id : null;
          if (!id) id = `E_${++seq}`;
          usedIds.add(id);
          edges.push({ data: { ...d, id } });
        });

        const nodes = Array.from(nodeMap.values());
        return { elements: { nodes, edges } };
      }

      // Expose
      window.handleUnifiedLoad = handleUnifiedLoad;
    })();

    // Minimal dialog
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
        <div style="color:#374151;margin-bottom:10px;">
          We detected CSV input. Select how to import:
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          <button id="csv-cobie" class="flat">COBie CSV files (Component/Type/System/Assembly/Space)</button>
          <button id="csv-onexus" class="flat">ONEXUS Edges CSV (from “Export CSV”)</button>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="csv-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        </div>
      `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const cleanup = () => overlay.remove();
        panel.querySelector('#csv-cancel').addEventListener('click', () => { cleanup(); reject(); });
        panel.querySelector('#csv-cobie').addEventListener('click', () => { cleanup(); resolve('cobie'); });
        panel.querySelector('#csv-onexus').addEventListener('click', () => { cleanup(); resolve('onexus-edges'); });
      });
    }

    // ONEXUS edges CSV -> graph injection (compatible with exportCSV in graph-core.js)
    function injectOnexusEdgesCsv(csvText) {
      // Rehydrate a graph with existing nodes (if present) or from endpoints
      // Minimal reader for the exact header set that exportCSV() writes.
      // Header: id,type,dimension,directional,source,target,phase,owner,risk,confidence,notes
      const lines = String(csvText || '').split(/\r?\n/).filter(Boolean);
      const header = (lines.shift() || '').split(',');
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
        nodesSet.add(source);
        nodesSet.add(target);
      }

      // Build nodes if they don't exist in the current graph
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
      // Inject using your public API
      if (typeof window.onexusLoadGraph === 'function') {
        // Merge: if there are existing nodes, we can add edges and new nodes on top
        // For simplicity, we load as a fresh graph here. Adjust to merge if desired.
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

    // Basic CSV line parser (handles quoted fields w/ commas and double-quotes)
    function parseCsvLine(line) {
      const out = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
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

    // Expose
    window.handleUnifiedLoad = handleUnifiedLoad;
  })();

})();