/* =========================================================
 ONEXUS – Safe Mode (Large Graph Stability Toggle)
 Goals:
 - Simple toggle: reduces clutter & improves responsiveness on large graphs
 - Class-based styling: adds "onx-safe" to edges (style rule in onexus-style.js)
 - Auto-enable for large graphs (e.g., IFC) only when user has no preference

 Depends on:
 - window.cy
 - window.setEdgeLabelVisibility / window.setNodeLabelVisibility
 - window.__onexus_state (from graph-core.state.js)
 - ONEXUS.bus event: "graphLoaded" (emitted by graph-core.io.host.js)

 Public API:
 - window.ONEXUS_SAFE_MODE.enable({persist?, reason?})
 - window.ONEXUS_SAFE_MODE.disable({persist?, reason?})
 - window.ONEXUS_SAFE_MODE.toggle()
 - window.ONEXUS_SAFE_MODE.isEnabled()
========================================================= */
(function () {
    const LS_KEY = "onexus.safeMode"; // "1" | "0" | null (unset => allow auto)
    const EDGE_CLASS = "onx-safe";

    const DEFAULT_THRESHOLDS = {
        nodes: 3000,
        edges: 8000,
        // if meta.importer === 'ifc' => prefer safe mode at lower sizes
        ifcNodes: 1500,
        ifcEdges: 4000,
    };

    const state = {
        enabled: false,
        prev: {
            showEdgeLabels: null,
            showNodeLabels: null,
        },
    };

    function readPref() {
        try {
            const v = localStorage.getItem(LS_KEY);
            if (v === "1") return true;
            if (v === "0") return false;
            return null; // unset
        } catch {
            return null;
        }
    }

    function writePref(v) {
        try {
            localStorage.setItem(LS_KEY, v ? "1" : "0");
        } catch { }
    }

    function clearPref() {
        try { localStorage.removeItem(LS_KEY); } catch { }
    }

    function getCoreState() {
        // Canonical state from graph-core.state.js
        return window.__onexus_state || null;
    }

    function getCy() {
        return window.cy || null;
    }

    function existsCy() {
        const c = getCy();
        return !!c && typeof c.edges === "function";
    }

    function batch(fn) {
        const c = getCy();
        if (!c) return fn();
        c.batch(fn);
    }

    function applyClasses(enable) {
        if (!existsCy()) return;
        const c = getCy();
        batch(() => {
            if (enable) c.edges().addClass(EDGE_CLASS);
            else c.edges().removeClass(EDGE_CLASS);
        });
    }

    function snapshotLabelPrefs() {
        const s = getCoreState();
        // If core state exists, snapshot from there; otherwise infer via truthy defaults.
        if (s) {
            state.prev.showEdgeLabels = (typeof s.showEdgeLabels === "boolean") ? s.showEdgeLabels : state.prev.showEdgeLabels;
            state.prev.showNodeLabels = (typeof s.showNodeLabels === "boolean") ? s.showNodeLabels : state.prev.showNodeLabels;
        } else {
            if (state.prev.showEdgeLabels === null) state.prev.showEdgeLabels = true;
            if (state.prev.showNodeLabels === null) state.prev.showNodeLabels = true;
        }
    }

    function applyLabelVisibilityForSafeMode(enable) {
        // On enable: hide edge labels, keep node labels on
        // On disable: restore prior values (if known)
        if (enable) snapshotLabelPrefs();

        try {
            window.setEdgeLabelVisibility?.(
                enable ? false : (state.prev.showEdgeLabels ?? true)
            );
        } catch { }

        try {
            window.setNodeLabelVisibility?.(
                enable ? true : (state.prev.showNodeLabels ?? true)
            );
        } catch { }
    }

    function enable(opts = {}) {
        const { persist = true, reason = "" } = opts;
        if (state.enabled) return;
        state.enabled = true;

        applyClasses(true);
        applyLabelVisibilityForSafeMode(true);

        if (persist) writePref(true);
        window.showTransientMessage?.(reason ? `Safe Mode enabled — ${reason}` : "Safe Mode enabled", 2000);
    }

    function disable(opts = {}) {
        const { persist = true, reason = "" } = opts;
        if (!state.enabled) return;
        state.enabled = false;

        applyClasses(false);
        applyLabelVisibilityForSafeMode(false);

        if (persist) writePref(false);
        window.showTransientMessage?.(reason ? `Safe Mode disabled — ${reason}` : "Safe Mode disabled", 1600);
    }

    function toggle() {
        if (state.enabled) disable({ persist: true });
        else enable({ persist: true });
    }

    function isEnabled() {
        return !!state.enabled;
    }

    // ---------- UI injection (Style panel) ----------
    function ensureUi() {
        const panel =
            document.getElementById("panelStyle") ||
            document.querySelector("#leftDrawer #panelStyle");

        if (!panel) return;
        if (panel.querySelector("#onxSafeModeToggle")) return;

        const wrap = document.createElement("div");
        wrap.style.marginTop = "12px";

        wrap.innerHTML = `
      <h3>Stability</h3>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-main);user-select:none;">
        <input id="onxSafeModeToggle" type="checkbox" style="width:14px;height:14px;accent-color:#2563eb;" />
        Safe Mode (large graphs)
      </label>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.35;">
        Simplifies edge rendering and hides edge labels to improve responsiveness on large graphs.
      </div>
    `;

        panel.appendChild(wrap);

        const cb = wrap.querySelector("#onxSafeModeToggle");
        cb.checked = state.enabled;

        cb.addEventListener("change", () => {
            if (cb.checked) enable({ persist: true, reason: "user toggle" });
            else disable({ persist: true, reason: "user toggle" });
        });
    }

    // ---------- Auto enable on graphLoaded (only if user pref not set) ----------
    function shouldAutoEnable({ graph, meta, counts }) {
        const pref = readPref();
        if (pref === true) return true;
        if (pref === false) return false;
        // pref unset => allow auto

        const importer = meta?.importer || graph?.meta?.importer || "";
        const n = counts?.nodes ?? 0;
        const e = counts?.edges ?? 0;

        if (String(importer).toLowerCase() === "ifc") {
            return n >= DEFAULT_THRESHOLDS.ifcNodes || e >= DEFAULT_THRESHOLDS.ifcEdges;
        }
        return n >= DEFAULT_THRESHOLDS.nodes || e >= DEFAULT_THRESHOLDS.edges;
    }

    function applyPrefOrAutoOnGraphLoaded(payload) {
        const pref = readPref();
        if (pref === true) {
            enable({ persist: false, reason: "saved preference" });
            return;
        }
        if (pref === false) {
            disable({ persist: false, reason: "saved preference" });
            return;
        }
        // pref unset => auto
        if (shouldAutoEnable(payload ?? {})) {
            enable({ persist: false, reason: "auto (large graph)" });
        } else {
            disable({ persist: false });
        }
    }

    function syncToggleCheckbox() {
        try {
            const cb = document.getElementById("onxSafeModeToggle");
            if (cb) cb.checked = state.enabled;
        } catch { }
    }

    function boot() {
        // Apply saved preference at startup (if set)
        const pref = readPref();
        if (pref === true) enable({ persist: false, reason: "saved preference" });
        else if (pref === false) disable({ persist: false });

        // Inject UI toggle (panel may be moved later by layout scripts)
        ensureUi();
        setTimeout(ensureUi, 200);
        setTimeout(ensureUi, 700);

        // Re-evaluate on graph loads (graph-core.io.host emits this)
        try {
            window.ONEXUS?.bus?.on?.("graphLoaded", (payload) => {
                applyPrefOrAutoOnGraphLoaded(payload ?? {});
                syncToggleCheckbox();
            });
        } catch { }

        // If edges are added after enabling, keep class applied
        if (existsCy()) {
            const c = getCy();
            if (!c.__onxSafeModeHooked) {
                c.__onxSafeModeHooked = true;
                c.on("add", "edge", () => {
                    if (!state.enabled) return;
                    try { getCy().edges().addClass(EDGE_CLASS); } catch { }
                });
            }
        }
    }

    // Expose API
    window.ONEXUS_SAFE_MODE = {
        enable,
        disable,
        toggle,
        isEnabled,
        clearPref,
        thresholds: DEFAULT_THRESHOLDS
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
    } else {
        setTimeout(boot, 0);
    }
})();