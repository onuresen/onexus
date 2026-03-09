/* ONEXUS - Namespace & Shared Helpers (no deps) */
(function () {
  const root = (window.ONEXUS = window.ONEXUS || {});
  root.version = root.version || "0.1";

  root.util = root.util || {};
  const U = root.util;

  U.debounce = U.debounce || function debounce(fn, ms = 120) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  U.clone = U.clone || function clone(x) {
    return (typeof structuredClone === "function")
      ? structuredClone(x)
      : JSON.parse(JSON.stringify(x));
  };

  U.exists = U.exists || function exists(col) {
    return !!col && !!col.nonempty && col.nonempty();
  };

  U.idSafe = U.idSafe || function idSafe(s) {
    return String(s ?? "").replace(/[^\w\-:.]+/g, "_");
  };

  // ✅ Correct HTML escape (used by loaders, dialogs, details renderers)
  U.escapeHtml = U.escapeHtml || function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  root.bus = root.bus || {
    on(type, fn) {
      document.addEventListener("onexus:" + type, (e) => fn(e.detail));
    },
    emit(type, detail) {
      document.dispatchEvent(new CustomEvent("onexus:" + type, { detail }));
    },
  };
})();