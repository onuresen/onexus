/* =========================================================
 ONEXUS – Compat Layer (non-breaking)
 - Normalizes core globals and exposes stable aliases.
 - Centralizes escapeHtml to avoid broken implementations.
 - Safe to include early (after onexus-ns.js).
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    ONX.util = ONX.util || {};

    // Canonical core globals used across modules (ensure they exist)
    window.__onexus_state = window.__onexus_state || window.___onexus_state || window.___onexus_state || null;
    window.__onexus_meta = window.__onexus_meta || window.___onexus_meta || window.___onexus_meta || null;
    window.__onexus_labels = window.__onexus_labels || window.___onexus_labels || null;

    // Alias common variants (defensive; no overwrites)
    if (!window.___onexus_state && window.__onexus_state) window.___onexus_state = window.__onexus_state;
    if (!window.___onexus_meta && window.__onexus_meta) window.___onexus_meta = window.__onexus_meta;
    if (!window.___onexus_labels && window.__onexus_labels) window.___onexus_labels = window.__onexus_labels;

    // Use canonical escapeHtml from onexus-ns.js (fallback included for safety)
    ONX.util.escapeHtml = ONX.util.escapeHtml || function escapeHtml(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };

    // Convenience “core” bucket (optional)
    ONX.core = ONX.core || {};
    Object.defineProperties(ONX.core, {
        state: { get: () => window.__onexus_state },
        meta: { get: () => window.__onexus_meta },
        labels: { get: () => window.__onexus_labels },
    });
})();