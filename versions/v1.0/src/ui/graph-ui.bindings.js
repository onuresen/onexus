// ===============================
// ONEXUS – Graph UI Bindings (toolbar/sidebar/search/drag&drop entry)
// ===============================

// prefs
const readPref = (k, d) => localStorage.getItem(k) ?? d;
const writePref = (k, v) => localStorage.setItem(k, v);
// attach helper
const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

// ===============================
// ONEXUS – Undo/Redo UI Sync (enable/disable buttons, auto-refresh)
// Depends on: window.ONEXUS_UNDO, #btnUndo, #btnRedo
// ===============================
(function () {
  function setBtnState(id, enabled) {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = !enabled;
    b.style.opacity = enabled ? "1" : "0.45";
    b.style.cursor = enabled ? "pointer" : "not-allowed";
    b.setAttribute("aria-disabled", (!enabled).toString());
  }

  function refreshUndoRedoButtons() {
    const U = window.ONEXUS_UNDO;
    const canUndo = !!U?.canUndo?.();
    const canRedo = !!U?.canRedo?.();
    setBtnState("btnUndo", canUndo);
    setBtnState("btnRedo", canRedo);
  }

  function hookUndoApiOnce() {
    const U = window.ONEXUS_UNDO;
    if (!U || U.__uiHooked) return;
    U.__uiHooked = true;

    const _do = U.do?.bind(U);
    const _undo = U.undo?.bind(U);
    const _redo = U.redo?.bind(U);
    const _clear = U.clear?.bind(U);

    if (_do) {
      U.do = (cmd) => {
        const r = _do(cmd);
        refreshUndoRedoButtons();
        return r;
      };
    }
    if (_undo) {
      U.undo = () => {
        const r = _undo();
        refreshUndoRedoButtons();
        return r;
      };
    }
    if (_redo) {
      U.redo = () => {
        const r = _redo();
        refreshUndoRedoButtons();
        return r;
      };
    }
    if (_clear) {
      U.clear = () => {
        const r = _clear();
        refreshUndoRedoButtons();
        return r;
      };
    }

    // initial
    refreshUndoRedoButtons();
  }

  function hookCyEventsOnce() {
    const cy = window.cy;
    if (!cy || cy.__undoUiHooked) return;
    cy.__undoUiHooked = true;

    // Layout stop is a good "graph stabilized" moment after loads/layout changes
    cy.on("layoutstop", () => refreshUndoRedoButtons());

    // If graph is reloaded or elements change, reflect that
    cy.on("add remove", () => refreshUndoRedoButtons());
  }

  // Boot: ONEXUS_UNDO might be defined after bindings load, so try multiple times safely
  function boot() {
    hookUndoApiOnce();
    hookCyEventsOnce();
    refreshUndoRedoButtons();
  }

  window.addEventListener("DOMContentLoaded", boot);
  // also run soon after script load (covers cases where DOM is already ready)
  setTimeout(boot, 120);

  // Expose (optional for debugging / other modules)
  window.refreshUndoRedoButtons = refreshUndoRedoButtons;
})();

// ---- CSV quick classifier (filename/header peek) ----
// Routes: 'cobie' | 'onexus-edges' | 'cobie-maybe' | 'unknown'
function classifyCsvText(name, text) {
  const lower = String(name ?? '').toLowerCase();

  // COBie sheet filenames (common variants)
  // - Component.csv / Type.csv / System.csv / Assembly.csv / Space.csv
  // - COBie_Component.csv, cobie-component.csv, etc.
  const cobieFileRe = /(^|[\/._-])(cobie[_-]?)?(component|type|system|assembly|space)\.csv$/i;
  if (cobieFileRe.test(lower)) return 'cobie';

  // ONEXUS edges CSV exported from app
  const head = String(text ?? '').split(/\r?\n/, 1)[0].toLowerCase();
  if (head.includes('id,type,dimension,directional,source,target')) return 'onexus-edges';

  // COBie-like header hint (loose)
  if (/(^|,)\s*(name|typename|space|floor|createdby)\s*(,|$)/i.test(head)) return 'cobie-maybe';

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

    // restore color mode
    const savedMode = readPref("onexus.colorMode", "json_category");
    const $mode = document.getElementById("colorModeSelect");
    if ($mode) {
      $mode.value = savedMode;
      window.applyColorMode?.(savedMode);
      $mode.addEventListener("change", () => {
        writePref("onexus.colorMode", $mode.value);
        window.applyColorMode?.($mode.value);
      });
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

// ===============================
// ONEXUS – GD Import UI (toolbar)
// Depends on: window.IMPORT_GD, #btnGD, #fileImportGD
// ===============================
(function () {
  // attach helper exists in this file: const on = (id, ev, fn) => ...
  // If you ever remove it, replace calls below with document.getElementById(...).addEventListener(...)

  function openGdImportDialog() {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10070
      });

      const panel = document.createElement("div");
      Object.assign(panel.style, {
        background: "#fff",
        minWidth: "420px",
        maxWidth: "520px",
        borderRadius: "10px",
        padding: "14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        fontSize: "13px",
        color: "#111"
      });

      panel.innerHTML = `
        <div style="font-weight:700;margin-bottom:8px;">Import Generative Design (GD)</div>
        <div style="color:#374151;line-height:1.45;margin-bottom:10px;">
          Choose how to apply the GD payload to the current graph.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <label style="display:flex;gap:8px;align-items:flex-start;">
            <input type="radio" name="gdMode" value="overlay" checked>
            <div>
              <div style="font-weight:600;">Overlay</div>
              <div style="font-size:12px;color:#6b7280;">Attach GD metrics onto existing nodes/edges (no new edges).</div>
            </div>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;">
            <input type="radio" name="gdMode" value="materialize-edges">
            <div>
              <div style="font-weight:600;">Materialize</div>
              <div style="font-size:12px;color:#6b7280;">Create an Option node + edges (Optimizes / domain edges).</div>
            </div>
          </label>
        </div>

        <label style="display:block;margin-bottom:10px;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Option Id (optional)</div>
          <input id="gdOptionId" type="text" placeholder="e.g., opt-123 (blank = auto pick)"
                 style="width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;">
        </label>

        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="gdCancel"
            style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;">
            Cancel
          </button>
          <button id="gdApply"
            style="padding:6px 10px;border:0;border-radius:8px;background:#111827;color:#fff;cursor:pointer;">
            Import
          </button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      const cleanup = () => overlay.remove();

      panel.querySelector("#gdCancel").addEventListener("click", () => {
        cleanup();
        reject(new Error("cancel"));
      });

      panel.querySelector("#gdApply").addEventListener("click", () => {
        const mode = panel.querySelector("input[name='gdMode']:checked")?.value || "overlay";
        const optionId = (panel.querySelector("#gdOptionId").value || "").trim() || null;
        cleanup();
        resolve({ mode, optionId });
      });

      // ESC to cancel
      const onEsc = (e) => {
        if (e.key === "Escape") {
          cleanup();
          document.removeEventListener("keydown", onEsc);
          reject(new Error("cancel"));
        }
      };
      document.addEventListener("keydown", onEsc);
    });
  }

  // Button -> open file input
  on("btnGD", "click", () => {
    const inp = document.getElementById("fileImportGD");
    if (!inp) return;
    inp.value = "";
    inp.click();
  });

  // File chosen -> parse -> choose mode -> import
  on("fileImportGD", "change", async (e) => {
    try {
      const file = e?.target?.files?.[0];
      if (!file) return;

      if (!window.IMPORT_GD?.importFromPayload) {
        alert("GD importer is not available (window.IMPORT_GD missing). Did you include gd-importer.js?");
        return;
      }

      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        alert("Invalid JSON: " + (err?.message || err));
        return;
      }

      const { mode, optionId } = await openGdImportDialog();
      window.IMPORT_GD.importFromPayload(payload, { mode, optionId });
    } catch (err) {
      if (String(err?.message || err).toLowerCase().includes("cancel")) return;
      alert("GD import failed: " + (err?.message || err));
    }
  });
})();