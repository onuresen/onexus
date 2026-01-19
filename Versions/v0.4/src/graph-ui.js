// ===============================
// ONEXUS – Graph UI Bindings
// ===============================
(function () {
  // Toolbar
  document.getElementById('languageSelect')?.addEventListener('change', (e) => {
    window.setLanguage?.(e.target.value);
  });
  document.getElementById('layoutSelect')?.addEventListener('change', (e) => {
    window.applyLayout?.(e.target.value);
  });
  document.getElementById('themeSelect')?.addEventListener('change', (e) => {
    window.applyTheme?.(e.target.value);   // from onexus-style.js
  });
  document.getElementById('fileInput')?.addEventListener('change', (e) => {
    window.loadJSON?.(e);                  // same as inline onchange
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
    switch ((e.key || "").toLowerCase()) {
      case "f": window.fitView?.(); break;
      case "c": window.centerView?.(); break;
      case "r": window.resetView?.(); break;
      case "p": window.exportPNG?.(); break;
      case "v": window.exportSVG?.(); break;
      case "j": window.exportJSON?.(); break;
      case "s": window.exportCSV?.(); break;
      case "l": window.exportLayout?.(); break;
    }
  });

  // Resize safety
  window.addEventListener("resize", () => {
    if (window.cy && typeof window.cy.resize === "function") {
      window.cy.resize();
    }
  });

  // Initial theme re-apply to sync canvas bg with CSS vars
  window.applyTheme?.('light');
})();