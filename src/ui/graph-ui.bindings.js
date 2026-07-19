// ===============================
// ONEXUS – Graph UI Bindings (trimmed, safe, both layouts)
// - Only binds to ids present in index.html or index_Classic.html
// - All handlers are guarded (no throw if element missing)
// Depends on:
// - graph-ui.loader.js (handleUnifiedLoad, injectOnexusEdgesCsv)
// - onexus-style.js (applyTheme/applyScale/applyColorMode)
// - graph-core.* (setLanguage/applyLayout/setLayerMode/etc.)
// - graph-core.compare.js (ONEXUS_COMPARE)
// - gd-importer.js (IMPORT_GD)
// ===============================

(() => {
  // ---------- small helpers ----------
  const readPref = (k, d) => {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
  };
  const writePref = (k, v) => {
    try { localStorage.setItem(k, String(v)); } catch { /* noop */ }
  };

  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(ev, fn);
  };

  const isEditingField = (e) => {
    const t = e?.target;
    const tag = (t?.tagName ?? "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable;
  };

  // ===============================
  // Panic Reset (escape from bad cached state)
  // - URL: add ?reset=1 to clear ONEXUS prefs
  // - Hotkey: Ctrl+Shift+R (no page reload) clears prefs + resets to Relationship
  // ===============================
  (function () {
    function clearOnexusPrefs() {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys
        .filter(k =>
          k && (
            k.startsWith("onexus.") ||
            k === "onexus.layerMode" ||
            k.startsWith("onexus.anim.")
          )
        )
        .forEach(k => { try { localStorage.removeItem(k); } catch { } });
    }

    function resetToSafeDefaults() {
      try { clearOnexusPrefs(); } catch { }
      try { window.setLayerMode?.("relationship", { persist: true, silent: true }); } catch { }
      try { window.setLanguage?.("en"); } catch { }
      try { window.applyTheme?.("light"); } catch { }
      try { window.applyLayout?.("default"); } catch { }
      try { window.showAllEdges?.(); } catch { }
      try { window.showTransientMessage?.("ONEXUS reset: cleared cached prefs"); } catch { }
    }

    // URL trigger: ?reset=1
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("reset") === "1") {
        resetToSafeDefaults();
        u.searchParams.delete("reset");
        history.replaceState({}, "", u.toString());
      }
    } catch { }

    // Hotkey: Ctrl+Shift+R (no reload)
    document.addEventListener("keydown", (e) => {
      if (isEditingField(e)) return;
      const isMac = navigator.platform?.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && (String(e.key || "").toLowerCase() === "r")) {
        e.preventDefault();
        resetToSafeDefaults();
      }
    });

    window.ONEXUS_RESET = resetToSafeDefaults;
  })();

  // ===============================
  // Undo/Redo UI Sync
  // Depends on: window.ONEXUS_UNDO, #btnUndo, #btnRedo (exist in both htmls)
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

      if (_do) U.do = (cmd) => { const r = _do(cmd); refreshUndoRedoButtons(); return r; };
      if (_undo) U.undo = () => { const r = _undo(); refreshUndoRedoButtons(); return r; };
      if (_redo) U.redo = () => { const r = _redo(); refreshUndoRedoButtons(); return r; };
      if (_clear) U.clear = () => { const r = _clear(); refreshUndoRedoButtons(); return r; };

      refreshUndoRedoButtons();
    }

    function hookCyEventsOnce() {
      const cy = window.cy;
      if (!cy || cy.__undoUiHooked) return;
      cy.__undoUiHooked = true;
      cy.on("layoutstop", refreshUndoRedoButtons);
      cy.on("add remove", refreshUndoRedoButtons);
    }

    function boot() {
      hookUndoApiOnce();
      hookCyEventsOnce();
      refreshUndoRedoButtons();
    }

    window.addEventListener("DOMContentLoaded", boot);
    setTimeout(boot, 120);
    window.refreshUndoRedoButtons = refreshUndoRedoButtons;
  })();

  // ===============================
  // Preferences restore + core dropdowns
  // ids exist in both htmls:
  // languageSelect, layoutSelect, themeSelect, sizeScale, sizeScaleLabel, colorModeSelect, fileInput
  // ===============================
  function updateScaleLabel(v) {
    const el = document.getElementById("sizeScaleLabel");
    if (el) el.textContent = `${Number(v).toFixed(2)}×`;
  }

  function restoreUiPrefs() {
    const lang = readPref("onexus.lang", "en");
    const theme = readPref("onexus.theme", "light");
    const layout = readPref("onexus.layout", "default");
    const scale = parseFloat(readPref("onexus.scale", "1"));
    let colorMode = readPref("onexus.colorMode", "json_category");
    // migration: old JLPT mode "level" removed from core
    if (colorMode === "level") colorMode = "json_category";

    const $lang = document.getElementById("languageSelect");
    const $theme = document.getElementById("themeSelect");
    const $layout = document.getElementById("layoutSelect");
    const $scale = document.getElementById("sizeScale");
    const $mode = document.getElementById("colorModeSelect");

    if ($lang) $lang.value = lang;
    if ($theme) $theme.value = theme;
    if ($layout) $layout.value = layout;
    if ($mode) $mode.value = colorMode;

    // Apply to engine (guarded)
    // Layer modes are retained as an internal compatibility API, but the
    // product always opens as a JSON-driven relationship graph.
    try { localStorage.removeItem("onexus.layerMode"); } catch { }
    try { window.setLayerMode?.("relationship", { persist: false, silent: true }); } catch { }
    try { window.setLanguage?.(lang); } catch { }
    try { window.applyTheme?.(theme); } catch { }
    try { window.applyLayout?.(layout); } catch { }
    try { window.applyColorMode?.(colorMode); } catch { }

    if ($scale && !Number.isNaN(scale)) {
      $scale.value = String(scale);
      updateScaleLabel(scale);
      try { window.applyScale?.(scale); } catch { }
    } else {
      updateScaleLabel(1);
      try { window.applyScale?.(1); } catch { }
    }
  }

  on("languageSelect", "change", (e) => {
    writePref("onexus.lang", e.target.value);
    window.setLanguage?.(e.target.value);
  });

  on("layoutSelect", "change", (e) => {
    writePref("onexus.layout", e.target.value);
    window.applyLayout?.(e.target.value);
  });

  on("themeSelect", "change", (e) => {
    writePref("onexus.theme", e.target.value);
    window.applyTheme?.(e.target.value);
  });

  on("sizeScale", "input", (e) => {
    const v = parseFloat(e.target.value || "1");
    writePref("onexus.scale", String(v));
    updateScaleLabel(v);
    window.applyScale?.(v);
  });

  on("colorModeSelect", "change", (e) => {
    writePref("onexus.colorMode", e.target.value);
    window.applyColorMode?.(e.target.value);
  });

  window.addEventListener("DOMContentLoaded", restoreUiPrefs);

  // ===============================
  // Label toggles (exist in both htmls, either sidebar or overlay controls)
  // ===============================
  on("toggleEdgeLabels", "change", (e) => window.setEdgeLabelVisibility?.(e.target.checked));
  on("toggleNodeLabels", "change", (e) => window.setNodeLabelVisibility?.(e.target.checked));

  // ===============================
  // File input (toolbar) -> unified loader
  // ===============================
  on("fileInput", "change", (e) => window.handleUnifiedLoad?.(e));

  // ===============================
  // Drag & drop to canvas -> unified loader (uses #canvas-wrap and #drop-hint)
  // ===============================
  (function () {
    const wrap = document.getElementById("canvas-wrap");
    const hint = document.getElementById("drop-hint");
    if (!wrap) return;

    const setHint = (show) => {
      if (hint) hint.style.display = show ? "flex" : "none";
    };

    wrap.addEventListener("dragenter", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setHint(true); });
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setHint(true); });
    wrap.addEventListener("dragleave", (e) => { e.preventDefault(); setHint(false); });

    wrap.addEventListener("drop", (e) => {
      e.preventDefault();
      setHint(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      window.handleUnifiedLoad?.({ target: { files } });
    });
  })();

  // ===============================
  // Undo/Redo buttons (exist in both htmls)
  // ===============================
  on("btnUndo", "click", () => window.ONEXUS_UNDO?.undo?.());
  on("btnRedo", "click", () => window.ONEXUS_UNDO?.redo?.());

  // ===============================
  // Compare (A/B) (exist in both htmls)
  // ===============================
  on("btnCompare", "click", () => {
    const inp = document.getElementById("fileCompareAB");
    if (!inp) return;
    inp.value = "";
    inp.click();
  });

  on("fileCompareAB", "change", (e) => {
    const files = Array.from(e?.target?.files ?? []);
    if (files.length !== 2) {
      alert("Please select exactly two JSON files for A/B compare.");
      return;
    }
    window.ONEXUS_COMPARE?.compareFromFilePair?.(files[0], files[1]);
  });

  // ===============================
  // GD Import UI (exist in both htmls)
  // ===============================
  function openGdImportDialog() {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10070
      });

      const panel = document.createElement("div");
      Object.assign(panel.style, {
        background: "#fff", minWidth: "420px", maxWidth: "520px",
        borderRadius: "10px", padding: "14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        fontSize: "13px", color: "#111"
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
        cleanup(); reject(new Error("cancel"));
      });

      panel.querySelector("#gdApply").addEventListener("click", () => {
        const mode = panel.querySelector("input[name='gdMode']:checked")?.value ?? "overlay";
        const optionId = (panel.querySelector("#gdOptionId").value || "").trim() || null;
        cleanup(); resolve({ mode, optionId });
      });

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

  on("btnGD", "click", () => {
    const inp = document.getElementById("fileImportGD");
    if (!inp) return;
    inp.value = "";
    inp.click();
  });

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
      try { payload = JSON.parse(text); }
      catch (err) { alert("Invalid JSON: " + (err?.message ?? err)); return; }

      const { mode, optionId } = await openGdImportDialog();
      window.IMPORT_GD.importFromPayload(payload, { mode, optionId });
    } catch (err) {
      const msg = String(err?.message ?? err).toLowerCase();
      if (msg.includes("cancel")) return;
      alert("GD import failed: " + (err?.message ?? err));
    }
  });

  // ===============================
  // Obsidian Import (directory-based)
  // ===============================
  on("btnObsidian", "click", async () => {
    try {
      // The Obsidian importer is directory-based: it calls showDirectoryPicker()
      // internally and ignores the files array. We can't go through importFilesAs()
      // because that bails immediately on an empty file list. Instead, find the
      // registered importer and call its importFiles() directly.
      const importers = window.ONEXUS?.plugins?.importers ?? [];
      const imp = importers.find(i => i.id === 'obsidian-md');
      if (!imp) {
        alert("Obsidian importer not loaded. Check that onexus-obsidian.plugin.js is in manifest.json.");
        return;
      }
      await imp.importFiles([], {});
    } catch (err) {
      const msg = String(err?.message ?? err).toLowerCase();
      if (msg.includes("cancel") || msg.includes("abort")) return;
      alert("Obsidian import failed: " + (err?.message ?? err));
    }
  });

  // ===============================
  // Animation controls (exist in both htmls)
  // ===============================
  on("animEdgeFlowOn", "click", () => {
    window.setAnimMode?.("edgeflow");
    const dim = document.getElementById("animEdgeFlowDim")?.value || "";
    const dash = document.getElementById("animEdgeFlowDash")?.value || "10,6";
    const parts = dash.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);

    window.setEdgeFlowDimension?.(dim || null);
    if (parts.length >= 2) window.setEdgeFlowPattern?.(parts[0], parts[1]);
  });

  on("animEdgeFlowOff", "click", () => window.setAnimMode?.("off"));

  on("animEdgeFlowDim", "change", (e) => window.setEdgeFlowDimension?.(e.target.value || null));

  on("animEdgeFlowDash", "change", (e) => {
    const parts = String(e.target.value || "10,6").split(",")
      .map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
    if (parts.length >= 2) window.setEdgeFlowPattern?.(parts[0], parts[1]);
  });

  // Orbit depth slider -> anim hook
  function updateOrbitDepthScaleLabel(v) {
    const el = document.getElementById("orbitDepthScaleLabel");
    if (el) el.textContent = `+${Math.round((Number(v || 0) * 100))}%`;
  }

  on("orbitDepthScale", "input", (e) => {
    const v = Math.max(0, Math.min(0.5, parseFloat(e.target.value || "0.2")));
    updateOrbitDepthScaleLabel(v);
    window.__onexus_anim_hook?.("orbitDepthScale", v);
  });

  window.addEventListener("DOMContentLoaded", () => {
    const v = document.getElementById("orbitDepthScale")?.value || "0.2";
    updateOrbitDepthScaleLabel(v);
  });

  // Phase reveal
  on("btnPhasePlay", "click", () => {
    const perMs = parseInt(document.getElementById("phaseSpeedMs")?.value || "700", 10);
    window.playPhaseReveal?.({ perPhaseMs: Math.max(100, perMs) });
  });
  on("btnPhaseStop", "click", () => window.stopPhaseReveal?.());

  // ===============================
  // Keyboard: H — toggle N-hop focus on selected node (F is taken by fitView)
  // ===============================
  document.addEventListener("keydown", (e) => {
    if (isEditingField(e)) return;
    if (String(e.key || "").toLowerCase() !== "h") return;

    const cy = window.cy;
    if (!cy) return;

    const selected = cy.nodes(":selected").first();
    const state = window.__onexus_state;

    if (!selected || !selected.length) {
      if (state?.focusedNode) {
        window.clearFocus?.();
        window.showTransientMessage?.("Focus cleared");
      }
      return;
    }

    if (state?.focusedNode?.id?.() === selected.id()) {
      window.clearFocus?.();
      window.showTransientMessage?.("Focus cleared");
    } else {
      if (state) state.focusedNode = selected;
      window.applyDepthFocus?.(selected);
      window.showTransientMessage?.(`Focus applied (${state?.focusDepth ?? 1}-hop)`);
    }
  });

  // ===============================
  // graphLoadFailed — reset file input so user can retry same file
  // ===============================
  window.ONEXUS?.bus?.on?.("graphLoadFailed", () => {
    const inp = document.getElementById("fileInput");
    if (inp) inp.value = "";
  });

  // Keep cy responsive on resize
  window.addEventListener("resize", () => window.cy?.resize?.());
})();

// ===============================
// Server persistence (Option A: disk files backend)
// ===============================
(function () {
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(ev, fn);
  };

  // crude prompts for now (simple + understandable)
  on("btnSaveServer", "click", async () => {
    try {
      const name = prompt("Save name?", "My ONEXUS Graph") || "Untitled";
      const id = await window.ONEXUS_PERSIST?.saveGraph?.({ name });
      // store last saved id so you can update later
      if (id) localStorage.setItem("onexus.persist.lastId", id);
    } catch (e) {
      alert("Save failed: " + (e?.message ?? e));
    }
  });

  on("btnOpenServer", "click", async () => {
    try {
      const list = await window.ONEXUS_PERSIST?.listGraphs?.();
      if (!list || !list.length) return alert("No saved graphs.");
      const choices = list.slice(0, 30).map(x => `${x.id}  |  ${x.name}`).join("\n");
      const pick = prompt("Pick a graph id:\n\n" + choices, list[0].id);
      if (!pick) return;
      await window.ONEXUS_PERSIST?.loadGraph?.(pick.trim());
      localStorage.setItem("onexus.persist.lastId", pick.trim());
    } catch (e) {
      alert("Load failed: " + (e?.message ?? e));
    }
  });
})();

// ===============================
// Persistence: Auto-save toggle (simple)
// ===============================
(function () {
  function ensureAutoSaveToggle() {
    const panel = document.getElementById("panelStyle");
    if (!panel) return;
    if (panel.querySelector("#onxAutoSaveToggle")) return;

    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    wrap.innerHTML = `
      <h3>Persistence</h3>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-main);user-select:none;">
        <input id="onxAutoSaveToggle" type="checkbox" style="width:14px;height:14px;accent-color:#2563eb;">
        Auto-save layout on drag
      </label>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.35;">
        Saves node positions automatically after you move nodes (requires one manual Save first).
      </div>
    `;
    panel.appendChild(wrap);

    const cb = wrap.querySelector("#onxAutoSaveToggle");
    cb.checked = window.ONEXUS_PERSIST?.getAutoSaveEnabled?.() !== false;
    cb.addEventListener("change", () => {
      window.ONEXUS_PERSIST?.setAutoSaveEnabled?.(cb.checked);
      window.showTransientMessage?.(cb.checked ? "Auto-save enabled" : "Auto-save disabled", 1400);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureAutoSaveToggle();
      setTimeout(ensureAutoSaveToggle, 300);
    });
  } else {
    ensureAutoSaveToggle();
    setTimeout(ensureAutoSaveToggle, 300);
  }
})();
