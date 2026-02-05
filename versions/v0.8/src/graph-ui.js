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
    document.getElementById('languageSelect')?.setAttribute('value', lang);
    document.getElementById('themeSelect')?.setAttribute('value', theme);
    document.getElementById('layoutSelect')?.setAttribute('value', layout);
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

  // Show / hide edge labels
  on('toggleEdgeLabels', 'change', e =>
    window.setEdgeLabelVisibility?.(e.target.checked)
  );

  on('toggleNodeLabels', 'change', e =>
    window.setNodeLabelVisibility?.(e.target.checked)
  );

  // Focus depth slider
  on('focusRange', 'input', e => window.setFocusDepth?.(e.target.value));

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
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      window.loadJSON?.({ target: { files: [file] } });
    } else if (lower.endsWith('.csv')) {
      window.handleUnifiedLoad?.({ target: { files: [file] } });
    } else if (lower.endsWith('.ifc')) {
      window.ONEXUS_IFC?.loadIFC({ target: { files: [file] } });
    } else {
      alert('Please drop JSON, CSV, or IFC here');
    }
  });

  // Unified loader for .json and .csv (COBie or ONEXUS edges CSV)
  (function () {
    async function handleUnifiedLoad(event) {
      const files = Array.from(event?.target?.files ?? []);
      if (!files.length) return;

      // Split by extension first
      const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
      const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
      const ifcFiles = files.filter(f => f.name.toLowerCase().endsWith('.ifc'));

      // JSON: pass-through
      if (jsonFiles.length) {
        // load first JSON (or loop if you prefer)
        const evt = { target: { files: [jsonFiles[0]] } };
        window.loadJSON?.(evt); // existing core function
      }

      if (ifcFiles.length) {
        // pass the whole event; importer grabs the first IFC
        return window.ONEXUS_IFC?.loadIFC(event);
      }

      if (!csvFiles.length) return;

      // Read first CSV to decide path; if multiple, we’ll route all accordingly
      const first = csvFiles[0];
      const text = await first.text().catch(() => '');
      const kind = classifyCsvText(first.name, text);

      // If clearly ONEXUS edges CSV:
      if (kind === 'onexus-edges') {
        injectOnexusEdgesCsv(text);
        return;
      }
      // If clearly COBie or filename hints indicate COBie:
      if (kind === 'cobie') {
        // Reuse your existing multi-CSV COBie loader
        const evt = { target: { files: csvFiles } };
        window.loadCOBieCSVs?.(evt);
        return;
      }

      // Ambiguous: prompt user to choose
      openCsvChoiceDialog()
        .then(choice => {
          if (choice === 'cobie') {
            const evt = { target: { files: csvFiles } };
            window.loadCOBieCSVs?.(evt);
          } else if (choice === 'onexus-edges') {
            injectOnexusEdgesCsv(text);
          }
        })
        .catch(() => {/* cancelled */ });
    }

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