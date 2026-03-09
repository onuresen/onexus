/* =========================================================
 ONEXUS – Perf: Hide labels during import + layout (robust)
 Fixes:
 - First import: elements are added AFTER graphWillLoad -> reapply hide on graphLoaded + on add
 - Layout mid-run: avoid early restore by using layoutstop + adaptive fallback
 - Prevent loader forcing labels ON mid-load by exposing ONEXUS_PERF.isTempLabelHide()
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    const bus = ONX.bus;

    if (!bus || typeof bus.on !== "function") return;

    const TEMP_CLASS = "onx-hide-labels-temp";
    const PREF_KEY = "onexus.perf.hideLabelsDuringLoad";
    const DEFAULT_ENABLED = true;

    function isEnabled() {
        try {
            const v = localStorage.getItem(PREF_KEY);
            if (v === "0") return false;
            if (v === "1") return true;
            return DEFAULT_ENABLED;
        } catch {
            return DEFAULT_ENABLED;
        }
    }

    window.ONEXUS_PERF = window.ONEXUS_PERF || {};
    window.ONEXUS_PERF.setHideLabelsDuringLoad = function (enabled) {
        try {
            localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
            window.showTransientMessage?.(
                enabled ? "Perf: hide labels during load/layout = ON" : "Perf: hide labels during load/layout = OFF",
                1600
            );
        } catch { }
    };
    window.ONEXUS_PERF.getHideLabelsDuringLoad = () => isEnabled();

    const snap = {
        active: false,
        prevEdge: null,
        prevNode: null,
        restoreTimer: 0,
        restoreToken: 0,
        hooked: false,
        addHooked: false,
    };

    // expose for other modules (e.g. io.host) to avoid forcing labels ON during hide window
    window.ONEXUS_PERF.isTempLabelHide = () => !!snap.active;

    function clearTimer() {
        if (snap.restoreTimer) {
            clearTimeout(snap.restoreTimer);
            snap.restoreTimer = 0;
        }
    }

    function getCoreState() {
        return window.__onexus_state || window.___onexus_state || null;
    }

    function applyHideClassToAll() {
        const cy = window.cy;
        if (!cy) return;
        try {
            cy.batch(() => {
                cy.nodes().addClass(TEMP_CLASS);
                cy.edges().addClass(TEMP_CLASS);
            });
        } catch { }
    }

    function removeHideClassFromAll() {
        const cy = window.cy;
        if (!cy) return;
        try {
            cy.batch(() => {
                cy.nodes().removeClass(TEMP_CLASS);
                cy.edges().removeClass(TEMP_CLASS);
            });
        } catch { }
    }

    function hideLabelsNow() {
        if (!isEnabled()) return;

        // snapshot prior preference once per cycle
        if (!snap.active) {
            const st = getCoreState();
            snap.prevEdge = st ? !!st.showEdgeLabels : null;
            snap.prevNode = st ? !!st.showNodeLabels : null;
        }

        // apply class-based hide (works regardless of set*Visibility timing)
        applyHideClassToAll();

        // also attempt to flip the built-in toggles (keeps state consistent)
        try { window.setEdgeLabelVisibility?.(false); } catch { }
        try { window.setNodeLabelVisibility?.(false); } catch { }

        snap.active = true;
    }

    function restoreLabelsNow() {
        if (!snap.active) return;

        clearTimer();
        removeHideClassFromAll();

        const edge = snap.prevEdge === null ? true : snap.prevEdge;
        const node = snap.prevNode === null ? true : snap.prevNode;

        try { window.setEdgeLabelVisibility?.(edge); } catch { }
        try { window.setNodeLabelVisibility?.(node); } catch { }

        snap.active = false;
    }

    function ensureHooks() {
        const cy = window.cy;
        if (!cy || snap.hooked) return;
        snap.hooked = true;

        // Restore on layoutstop (best signal)
        cy.on("layoutstop", () => {
            if (!snap.active) return;
            const token = snap.restoreToken;
            setTimeout(() => {
                if (snap.restoreToken !== token) return;
                restoreLabelsNow();
            }, 0);
        });

        // While active: any new elements added should receive the hide class
        if (!snap.addHooked) {
            snap.addHooked = true;
            cy.on("add", (evt) => {
                if (!snap.active) return;
                try {
                    const ele = evt.target;
                    if (ele && ele.isNode && ele.isNode()) ele.addClass(TEMP_CLASS);
                    else if (ele && ele.isEdge && ele.isEdge()) ele.addClass(TEMP_CLASS);
                } catch { }
            });
        }
    }

    function adaptiveFallbackMs() {
        const cy = window.cy;
        if (!cy) return 4000;
        const n = cy.nodes().length;
        const e = cy.edges().length;
        // Layout duration scales with size; avoid restoring early.
        // Clamp: 4s..15s
        const ms = 1500 + (n + e) * 1.2;
        return Math.max(4000, Math.min(15000, ms));
    }

    function scheduleRestoreAfterLayout() {
        if (!isEnabled()) return;

        // invalidate previous cycle
        snap.restoreToken++;
        clearTimer();
        ensureHooks();

        // keep hiding (important for first import: apply after elements exist)
        hideLabelsNow();

        // fallback if layoutstop never fires (very rare)
        snap.restoreTimer = setTimeout(() => {
            restoreLabelsNow();
        }, adaptiveFallbackMs());
    }

    // -------------------------------
    // Import lifecycle (from io.host)
    // -------------------------------
    bus.on("graphWillLoad", () => {
        if (!isEnabled()) return;
        snap.restoreToken++;
        clearTimer();
        hideLabelsNow(); // may run before elements exist — OK (we reapply later)
    });

    bus.on("graphLoaded", () => {
        // Now elements exist; ensure they get the hide class and wait for layoutstop.
        scheduleRestoreAfterLayout();
    });

    bus.on("graphLoadFailed", () => {
        restoreLabelsNow();
    });

    // -------------------------------
    // Layout lifecycle (wrap applyLayout)
    // -------------------------------
    function wrapApplyLayoutOnce() {
        if (wrapApplyLayoutOnce._done) return;
        if (typeof window.applyLayout !== "function") return;
        wrapApplyLayoutOnce._done = true;

        const orig = window.applyLayout;
        window.applyLayout = function (type) {
            if (!isEnabled()) return orig.call(this, type);

            // hide immediately + restore after layoutstop/fallback
            scheduleRestoreAfterLayout();
            return orig.call(this, type);
        };
    }

    function boot() {
        ensureHooks();
        wrapApplyLayoutOnce();
        // retry in case applyLayout comes later
        setTimeout(wrapApplyLayoutOnce, 120);
        setTimeout(wrapApplyLayoutOnce, 500);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
})();