/* ONEXUS – IO Export (PNG/SVG/JSON/CSV/Layout/Schema) */
(function () {
  const cy = window.cy;

  function download(filename, dataUrlOrBlob) {
    const a = document.createElement("a");

    // If Blob -> object URL, if string -> data URL
    const isString = typeof dataUrlOrBlob === "string";
    const href = isString ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);

    a.href = href;
    a.download = filename;
    a.click();

    // Revoke only object URLs
    if (!isString) {
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  }

  function exportPNG() {
    const themeKey =
      window.getCurrentThemeKey?.() ??
      window.currentTheme ??
      "light";

    const bg =
      window.THEMES?.[themeKey]?.canvas ??
      "#ffffff";

    const png = cy.png({ full: true, scale: 2, bg });
    download("onexus-graph.png", png);
  }

  function exportSVG() {
    if (typeof cy.svg === "function") {
      const svg = cy.svg({ full: true });
      download(
        "onexus-graph.svg",
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
      );
    } else {
      alert("SVG export requires cytoscape-svg plugin.");
    }
  }

  function exportJSON() {
    // Export the complete graph, not just the current view — filters/layers
    // hide elements transiently and "Export Graph JSON" should be lossless.
    const nodes = cy.nodes().map((n) => ({ data: n.data() }));
    const edges = cy.edges().map((e) => ({ data: e.data() }));

    const payload = {
      elements: { nodes, edges },
      meta: {
        exportedAt: new Date().toISOString(),
        theme: window.getCurrentThemeKey?.() ?? window.currentTheme ?? "light",
        scale: window.getCurrentScale?.() ?? window.currentScale?.() ?? 1,
      },
    };

    download(
      "onexus-graph.json",
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
  }

  function exportCSV() {
    const rows = [[
      "id", "type", "dimension", "directional", "source", "target",
      "phase", "owner", "risk", "confidence", "notes"
    ]];

    cy.edges(":visible").forEach((e) => {
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
        String(d.notes ?? "").replace(/\n/g, " "),
      ]);
    });

    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    download("onexus-edges.csv", new Blob([csv], { type: "text/csv" }));
  }

  function exportLayout() {
    const pos = cy.nodes().map((n) => ({ id: n.id(), position: n.position() }));
    download(
      "onexus-layout.json",
      new Blob([JSON.stringify({ positions: pos }, null, 2)], { type: "application/json" })
    );
  }

  function downloadSchema() {
    download("onexus-graph.schema.json", "schemas/onexus-graph.schema.json");
    try {
      window.showTransientMessage?.(
        "Schema downloaded — upload it to any AI and ask it to convert your data to match it.",
        2600
      );
    } catch { }
  }

  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;
  window.downloadSchema = downloadSchema;
})();