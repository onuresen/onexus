/* =========================================================
 ONEXUS – Compat Layer (non-breaking)
 - Normalizes core globals and exposes stable aliases.
 - Keeps __onexus_state/meta/labels and ___onexus_* ALWAYS in sync.
 - Emits: ONEXUS.bus.emit("coreReady", {state,meta,labels})
 Safe to include early (after onexus-ns.js).
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    ONX.util = ONX.util || {};
    ONX.core = ONX.core || {};

    const bus = ONX.bus;

    function bridgeGlobal(name) {
        const alt = "___" + name.slice(2); // __onexus_state -> ___onexus_state
        const hasProp = Object.prototype.hasOwnProperty.call(window, name);
        const desc = Object.getOwnPropertyDescriptor(window, name);

        // If already bridged (getter/setter), do nothing.
        if (desc && (typeof desc.get === "function" || typeof desc.set === "function")) return;

        let ref = window[name] ?? window[alt] ?? null;

        Object.defineProperty(window, name, {
            configurable: true,
            enumerable: true,
            get() { return ref; },
            set(v) {
                ref = v;
                try { window[alt] = v; } catch { /* ignore */ }
                try {
                    // notify listeners when core becomes available/changes
                    bus?.emit?.("coreReady", {
                        state: window.__onexus_state ?? window.___onexus_state ?? null,
                        meta: window.__onexus_meta ?? window.___onexus_meta ?? null,
                        labels: window.__onexus_labels ?? window.___onexus_labels ?? null
                    });
                } catch { }
            }
        });

        // Ensure alias exists immediately
        try { window[alt] = ref; } catch { /* ignore */ }

        // If the global existed before, re-set once to trigger setter (and sync alias)
        if (hasProp) {
            const cur = ref;
            window[name] = cur;
        }
    }

    // Bridge the 3 critical core globals
    bridgeGlobal("__onexus_state");
    bridgeGlobal("__onexus_meta");
    bridgeGlobal("__onexus_labels");

    // Canonical escapeHtml (single source)
    ONX.util.escapeHtml = function escapeHtml(s) {
        const fn = window.ONEXUS?.util?.escapeHtml;
        if (typeof fn === "function" && fn !== escapeHtml) return fn(s);
        const str = String(s ?? "");
        if (!/[&<>"']/.test(str)) return str;
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };

    // Stable getters for modules: use these instead of touching globals directly
    ONX.core.getState = () => window.__onexus_state ?? window.___onexus_state ?? {};
    ONX.core.getMeta = () => window.__onexus_meta ?? window.___onexus_meta ?? {};
    ONX.core.getLabels = () => window.__onexus_labels ?? window.___onexus_labels ?? {};

    Object.defineProperties(ONX.core, {
        state: { get: () => window.__onexus_state ?? window.___onexus_state ?? null },
        meta: { get: () => window.__onexus_meta ?? window.___onexus_meta ?? null },
        labels: { get: () => window.__onexus_labels ?? window.___onexus_labels ?? null }
    });
})();

// Replace scattered reads like:
// const st = window.__onexus_state || window.___onexus_state;
// with
// const st = window.ONEXUS?.core?.getState?.() ?? {};