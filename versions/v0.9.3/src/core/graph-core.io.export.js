/* ONEXUS – IO Export (PNG/SVG/JSON/CSV/Layout) */
(function () {
  const cy = window.cy;

  // --- download helper
  function download(filename, mime, dataUrlOrBlob) {
    const a = document.createElement("a");
    a.href = typeof dataUrlOrBlob === "string" ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- exports
  function exportPNG() {
    const bg = (window.THEMES?.[window.currentTheme]?.canvas) || (typeof THEMES !== 'undefined' ? THEMES[currentTheme].canvas : "#ffffff");
    const png = cy.png({ full: true, scale: 2, bg });
    download("onexus-graph.png", "image/png", png);
  }

  function exportSVG() {
    if (typeof cy.svg === "function") {
      const svg = cy.svg({ full: true });
      download("onexus-graph.svg", "image/svg+xml", new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    } else {
      alert("SVG export requires cytoscape-svg plugin.");
    }
  }

  function exportJSON() {
    const nodes = cy.nodes(":visible").map(n => ({ data: n.data() }));
    const edges = cy.edges(":visible").map(e => ({ data: e.data() }));
    const payload = { elements: { nodes, edges }, meta: { exportedAt: new Date().toISOString() } };
    download("onexus-graph.json", "application/json", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  }

  function exportCSV() {
    const rows = [["id", "type", "dimension", "directional", "source", "target", "phase", "owner", "risk", "confidence", "notes"]];
    cy.edges(":visible").forEach(e => {
      const d = e.data();
      rows.push([
        d.id,
        d.type,
        d.dimension,
        d.directional ? "1" : "0",
        d.source,
        d.target,
        (d.phase ?? []).join("\n"),
        d.owner ?? "",
        d.risk ?? "",
        d.confidence ?? "",
        (d.notes ?? "").replace(/\n/g, " ")
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    download("onexus-edges.csv", "text/csv", new Blob([csv], { type: "text/csv" }));
  }

  function exportLayout() {
    const pos = cy.nodes().map(n => ({ id: n.id(), position: n.position() }));
    download("onexus-layout.json", "application/json", new Blob([JSON.stringify({ positions: pos }, null, 2)], { type: "application/json" }));
  }

  // expose
  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;
})();