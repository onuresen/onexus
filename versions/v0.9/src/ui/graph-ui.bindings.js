// ===============================
// ONEXUS – Graph UI Bindings (toolbar/sidebar/search/drag&drop entry)
// ===============================

// prefs
const readPref = (k, d) => localStorage.getItem(k) ?? d;
const writePref = (k, v) => localStorage.setItem(k, v);
// attach helper
const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

// ---- CSV quick classifier (filename/header peek) ----
// NOTE: kept lightweight here so we can quickly route to CSV choice without parsing full file.
function classifyCsvText(name, text) {
  const lower = (name ?? '').toLowerCase();
  if (/\b(component|type|system|assembly|space)\.csv$/.test(lower)) return 'cobie';
  const head = String(text ?? '').split(/\r?\n/, 1)[0].toLowerCase();
  if (head.includes('id,type,dimension,directional,source,target')) return 'onexus-edges';
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
    // restore size scale
    const savedScale = parseFloat(readPref('onexus.scale', '1'));
    const $scale = document.getElementById('sizeScale');
    if ($scale && !Number.isNaN(savedScale)) {
      $scale.value = String(savedScale);
      updateScaleLabel(savedScale);
      window.applyScale?.(savedScale);
    } else {
      updateScaleLabel(1);
      window.applyScale?.(1);
    }
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

  // Undo/Redo buttons
  on('btnUndo', 'click', () => window.ONEXUS_UNDO?.undo?.());
  on('btnRedo', 'click', () => window.ONEXUS_UNDO?.redo?.());

  // Node search (label/id); highlight class/style is defined in onexus-style.js
  on('nodeSearch', 'input', e => {
    const q = (e.target.value ?? '').toLowerCase().trim();
    const cy = window.cy;
    if (!cy) return;
    cy.elements().removeClass('highlight');
    if (!q) return;
    const hits = cy.nodes().filter(n =>
      n.id().toLowerCase().includes(q) ||
      String(n.data('displayLabel') ?? '').toLowerCase().includes(q)
    );
    hits.addClass('highlight');
    if (hits.nonempty?.()) cy.fit(hits, 60);
  });

  // Sidebar: filters/lens/labels
  on('categoryFilter', 'change', e => window.filterByCategory?.(e.target.value));
  on('lensSystem', 'click', () => window.filterByDimension?.('System'));
  on('lensSpatial', 'click', () => window.filterByDimension?.('Spatial'));
  on('lensResp', 'click', () => window.filterByDimension?.('Responsibility'));
  on('lensAll', 'click', () => window.showAllEdges?.());
  on('lensVendor', 'click', () => window.filterByDimension?.('Vendor'));
  on('toggleEdgeLabels', 'change', e => window.setEdgeLabelVisibility?.(e.target.checked));
  on('toggleNodeLabels', 'change', e => window.setNodeLabelVisibility?.(e.target.checked));
  on('focusRange', 'input', e => window.setFocusDepth?.(e.target.value));
  // Size scale (visual scale; no relayout)
  const updateScaleLabel = (v) => {
    const el = document.getElementById('sizeScaleLabel');
    if (el) el.textContent = `${Number(v).toFixed(2)}×`;
  };
  on('sizeScale', 'input', (e) => {
    const v = parseFloat(e.target.value || '1');
    writePref('onexus.scale', String(v));
    updateScaleLabel(v);
    window.applyScale?.(v);
  });

  // Compare (A/B)
  on('btnCompare', 'click', () => {
    const inp = document.getElementById('fileCompareAB');
    if (inp) { inp.value = ''; inp.click(); }
  });
  on('fileCompareAB', 'change', (e) => {
    const files = Array.from(e?.target?.files ?? []);
    if (files.length !== 2) { alert('Please select exactly two JSON files for A/B compare.'); return; }
    window.ONEXUS_COMPARE?.compareFromFilePair(files[0], files[1]);
  });

  // === Edge Flow: start/stop ===
  on('animEdgeFlowOn', 'click', () => {
    // switch to edgeflow mode (doesn't auto-run; user toggles the main Run/Stop as before)
    window.setAnimMode?.('edgeflow');
    // apply current UI settings
    const dim = document.getElementById('animEdgeFlowDim')?.value || '';
    const dash = document.getElementById('animEdgeFlowDash')?.value || '10,6';
    const parts = dash.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
    if (window.setEdgeFlowDimension) window.setEdgeFlowDimension(dim || null);
    if (window.setEdgeFlowPattern && parts.length >= 2) window.setEdgeFlowPattern(parts[0], parts[1]);
  });

  on('animEdgeFlowOff', 'click', () => {
    // revert to "off" or any preferred neutral mode
    window.setAnimMode?.('off');
  });

  // Live-update settings
  on('animEdgeFlowDim', 'change', (e) => {
    if (window.setEdgeFlowDimension) window.setEdgeFlowDimension(e.target.value || null);
  });
  on('animEdgeFlowDash', 'change', (e) => {
    const parts = String(e.target.value || '10,6').split(',')
      .map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
    if (window.setEdgeFlowPattern && parts.length >= 2) window.setEdgeFlowPattern(parts[0], parts[1]);
  });

  // === Orbit depth scale ===
  const updateOrbitDepthScaleLabel = (v) => {
    const el = document.getElementById('orbitDepthScaleLabel');
    if (el) el.textContent = `+${Math.round((Number(v) || 0) * 100)}%`;
  };
  on('orbitDepthScale', 'input', (e) => {
    const v = Math.max(0, Math.min(0.5, parseFloat(e.target.value || '0.2')));
    updateOrbitDepthScaleLabel(v);
    // write into anim object through a convenience hook
    if (!window.__onexus_setOrbitDepthScale) {
      // create a thin setter if not present
      window.__onexus_setOrbitDepthScale = (x) => { try { window.__onexus_anim_hook?.('orbitDepthScale', x); } catch { } };
    }
    window.__onexus_setOrbitDepthScale(v);
  });
  // initialize label at startup
  window.addEventListener('DOMContentLoaded', () => {
    const v = document.getElementById('orbitDepthScale')?.value || '0.2';
    updateOrbitDepthScaleLabel(v);
  });

  // === Phase Reveal player ===
  on('btnPhasePlay', 'click', () => {
    const perMs = parseInt(document.getElementById('phaseSpeedMs')?.value || '700', 10);
    window.playPhaseReveal?.({ perPhaseMs: Math.max(100, perMs) });
  });
  on('btnPhaseStop', 'click', () => window.stopPhaseReveal?.());

  on('animModeTop', 'change', (e) => window.setAnimMode?.(e.target.value));
  window.addEventListener('DOMContentLoaded', () => {
    const $m = document.getElementById('animModeTop');
    if ($m) $m.value = 'off';
  });

  // Canvas resize
  window.addEventListener('resize', () => window.cy?.resize?.());

  // File input (toolbar) -> unified loader
  on('fileInput', 'change', e => window.handleUnifiedLoad?.(e));

  // Drag & drop to canvas -> unified loader
  (function () {
    const wrap = document.getElementById('canvas-wrap');
    const hint = document.getElementById('drop-hint');
    if (!wrap) return;
    const setHint = (show) => hint && (hint.style.display = show ? 'flex' : 'none');
    wrap.addEventListener('dragenter', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHint(true); });
    wrap.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHint(true); });
    wrap.addEventListener('dragleave', e => { e.preventDefault(); setHint(false); });
    wrap.addEventListener('drop', async e => {
      e.preventDefault();
      setHint(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;

      // Quick CSV disambiguation when dragging a single CSV:
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.csv')) {
        const text = await files[0].text().catch(() => '');
        const kind = classifyCsvText(files[0].name, text);
        if (kind === 'onexus-edges') { window.injectOnexusEdgesCsv?.(text); return; }
        if (kind.startsWith('cobie')) { window.loadCOBieCSVs?.({ target: { files } }); return; }
        // Else: fall back to dialog via unified loader
      }

      // Route entire list to unified loader (JSON merge, IFC, CSV choice)
      window.handleUnifiedLoad?.({ target: { files } });
    });
  })();
})();