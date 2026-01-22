// ===============================
// ONEXUS – Graph UI Bindings
// ===============================

const readPref = (k, d) => localStorage.getItem(k) ?? d;
const writePref = (k, v) => localStorage.setItem(k, v);

// Helper to attach listener if element exists
const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

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
  on('fileInput', 'change', e => window.loadJSON?.(e));

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
    if (file?.name?.toLowerCase().endsWith('.json')) {
      window.loadJSON?.({ target: { files: [file] } });
    } else {
      alert('Please drop a .json file.');
    }
  });
})();