// ===============================
// ONEXUS – Graph UI Bindings
// ===============================

const readPref = (k, d) => (localStorage.getItem(k) ?? d);
const writePref = (k,v) => localStorage.setItem(k, v);

(function () {
  // Toolbar
  document.getElementById('languageSelect')?.addEventListener('change', e => {
    writePref('onexus.lang', e.target.value);
    window.setLanguage?.(e.target.value);
  });
  document.getElementById('layoutSelect')?.addEventListener('change', e => {
    writePref('onexus.layout', e.target.value);
    window.applyLayout?.(e.target.value);
  });
  document.getElementById('themeSelect')?.addEventListener('change', e => {
    writePref('onexus.theme', e.target.value);
    window.applyTheme?.(e.target.value);
  });
  document.getElementById('fileInput')?.addEventListener('change', (e) => {
    window.loadJSON?.(e);                  // same as inline onchange
  });
  
  // Preferences on startup
  window.addEventListener('DOMContentLoaded', () => {
    const lang = readPref('onexus.lang', 'en');
    const theme = readPref('onexus.theme', 'light');
    const layout = readPref('onexus.layout', 'default');
    const langSel = document.getElementById('languageSelect');
    const themeSel = document.getElementById('themeSelect');
    const layoutSel = document.getElementById('layoutSelect');
    if (langSel) langSel.value = lang;
    if (themeSel) themeSel.value = theme;
    if (layoutSel) layoutSel.value = layout;
    window.setLanguage?.(lang);
    window.applyTheme?.(theme);
    window.applyLayout?.(layout);
  });

  // Icon buttons
  document.getElementById('btnFit')?.addEventListener('click', () => window.fitView?.());
  document.getElementById('btnCenter')?.addEventListener('click', () => window.centerView?.());
  document.getElementById('btnReset')?.addEventListener('click', () => window.resetView?.());

  document.getElementById('btnPng')?.addEventListener('click', () => window.exportPNG?.());
  document.getElementById('btnSvg')?.addEventListener('click', () => window.exportSVG?.());
  document.getElementById('btnJson')?.addEventListener('click', () => window.exportJSON?.());
  document.getElementById('btnCsv')?.addEventListener('click', () => window.exportCSV?.());
  document.getElementById('btnLayout')?.addEventListener('click', () => window.exportLayout?.());

  // --- Node search
  document.getElementById('nodeSearch')?.addEventListener('input', (e) => {
    const q = (e.target.value || '').toLowerCase().trim();
    const cy = window.cy; if (!cy) return;
    cy.elements().removeClass('highlight');
    if (!q) return;
    const hits = cy.nodes().filter(n =>
      n.id().toLowerCase().includes(q) ||
      (String(n.data('displayLabel') || '').toLowerCase().includes(q))
    );
    hits.addClass('highlight');
    if (hits.nonempty()) cy.fit(hits, 60);
  });

  // Sidebar
  document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
    window.filterByCategory?.(e.target.value);
  });
  document.getElementById('lensSystem')?.addEventListener('click', () => window.filterByDimension?.('System'));
  document.getElementById('lensSpatial')?.addEventListener('click', () => window.filterByDimension?.('Spatial'));
  document.getElementById('lensResp')?.addEventListener('click', () => window.filterByDimension?.('Responsibility'));
  document.getElementById('lensAll')?.addEventListener('click', () => window.showAllEdges?.());

  // Focus depth
  document.getElementById('focusRange')?.addEventListener('input', (e) => {
    window.setFocusDepth?.(e.target.value);
  });

  // Keyboard shortcuts (F, C, R, P, V, J, S, L)
  document.addEventListener("keydown", (e) => {
    const tag = (e.target || {}).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === '?') {
      const h = document.getElementById('help');
      if (h) h.style.display = (h.style.display === 'flex' ? 'none' : 'flex');
    }
  });

  // Resize safety
  window.addEventListener("resize", () => {
    if (window.cy && typeof window.cy.resize === "function") {
      window.cy.resize();
    }
  });
})();

// --- Drag & drop JSON support on canvas
(function () {
  const wrap = document.getElementById('canvas-wrap');
  const hint = document.getElementById('drop-hint');
  if (!wrap) return;

  const show = () => hint && (hint.style.display = 'flex');
  const hide = () => hint && (hint.style.display = 'none');

  ['dragenter','dragover'].forEach(ev =>
    wrap.addEventListener(ev, e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; show(); })
  );
  ['dragleave','drop'].forEach(ev =>
    wrap.addEventListener(ev, e => { e.preventDefault(); hide(); })
  );

  wrap.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file?.name?.toLowerCase().endsWith('.json')) {
      const fe = { target: { files: [file] } };
      window.loadJSON?.(fe);
    } else {
      alert('Please drop a .json file.');
    }
  });
})();

// “Load sample” button
document.getElementById('btnLoadSample')?.addEventListener('click', async () => {
  const res = await fetch('./onexus_sample.json');
  const text = await res.text();
  const fe = { target:{ files:[ new File([text], 'onexus_sample.json', {type:'application/json'}) ] } };
  window.loadJSON?.(fe);
});