/* ONEXUS – IO (load/validate), Export, Host Integration */
(function () {
  const cy = window.cy;
  const LABELS = window.__onexus_labels;

  // ---- download helper
  function download(filename, mime, dataUrlOrBlob) {
    const a = document.createElement("a");
    a.href = typeof dataUrlOrBlob === "string" ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- exports
  function exportPNG() {
    const png = cy.png({ full: true, scale: 2, bg: THEMES[currentTheme].canvas });
    download("onexus-graph.png", "image/png", png);
  }
  function exportSVG() {
    if (typeof cy.svg === "function") {
      const svg = cy.svg({ full: true });
      download("onexus-graph.svg", "image/svg+xml", new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    } else { alert("SVG export requires cytoscape-svg plugin."); }
  }
  function exportJSON() {
    const nodes = cy.nodes(":visible").map(n => ({ data: n.data() }));
    const edges = cy.edges(":visible").map(e => ({ data: e.data() }));
    const blob = new Blob([JSON.stringify({ elements: { nodes, edges }, meta: { exportedAt: new Date().toISOString() } }, null, 2)], { type: "application/json" });
    download("onexus-graph.json", "application/json", blob);
  }
  function exportCSV() {
    const rows = [["id", "type", "dimension", "directional", "source", "target", "phase", "owner", "risk", "confidence", "notes"]];
    cy.edges(":visible").forEach(e => {
      const d = e.data();
      rows.push([d.id, d.type, d.dimension, d.directional ? "1" : "0", d.source, d.target, (d.phase ?? []).join("\n"), d.owner ?? "", d.risk ?? "", d.confidence ?? "", (d.notes ?? "").replace(/\n/g, " ")]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    download("onexus-edges.csv", "text/csv", new Blob([csv], { type: "text/csv" }));
  }
  function exportLayout() {
    const pos = cy.nodes().map(n => ({ id: n.id(), position: n.position() }));
    download("onexus-layout.json", "application/json", new Blob([JSON.stringify({ positions: pos }, null, 2)], { type: "application/json" }));
  }

  // ---- load JSON & validation
  function validateOnexusJson(data) {
    const errors = [];
    if (!data || !data.elements) { errors.push("Missing `elements`."); return { valid: false, errors }; }
    if (!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");
    (data.elements.nodes ?? []).forEach((n, i) => {
      const d = n?.data ?? {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category) errors.push(`nodes[${i}].data.category is required`);
      if (typeof d.label !== "object") errors.push(`nodes[${i}].data.label must be an object`);
    });
    (data.elements.edges ?? []).forEach((e, i) => {
      const d = e?.data ?? {};
      if (!d.id) errors.push(`edges[${i}].data.id is required`);
      if (!d.type) errors.push(`edges[${i}].data.type is required`);
      if (!d.dimension) errors.push(`edges[${i}].data.dimension is required`);
      if (!d.source) errors.push(`edges[${i}].data.source is required`);
      if (!d.target) errors.push(`edges[${i}].data.target is required`);
      if (typeof d.directional !== "boolean") errors.push(`edges[${i}].data.directional must be boolean`);
    });
    return { valid: errors.length === 0, errors };
  }

  function loadJSON(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data; try { data = JSON.parse(e.target.result); } catch (err) { alert("Invalid JSON: " + err.message); return; }
      const { valid, errors } = validateOnexusJson(data); if (!valid) { alert("Schema errors:\n" + errors.join("\n")); return; }
      cy.elements().remove();
      cy.add(data.elements.nodes); cy.add(data.elements.edges);
      window.setLanguage?.(window.__onexus_state?.language ?? "en");
      window.buildCategoryFilter?.(); window.applyTheme?.(localStorage.getItem('onexus.theme') ?? 'light');
      window.buildPhaseFilter?.();
      window.applyLayout?.("default"); cy.fit(undefined, 50);
      window.setEdgeLabelVisibility?.(true); window.setNodeLabelVisibility?.(true);
      window.buildRelationshipLegend?.(); window.updateMetrics?.();
    };
    reader.readAsText(file);
  }

  // ---- host integration
  function loadGraphObject(graph) {
    try {
      const res = validateOnexusJson(graph);
      if (res && res.valid === false) {
        console.error('ONEXUS schema errors:', res.errors);
        alert('Invalid ONEXUS JSON:\n' + res.errors.join('\n'));
        return;
      }
      const c = window.cy; if (!c) {
        console.error('Cytoscape not ready');
        return;
      }
      c.elements().remove(); c.add(graph.elements?.nodes ?? []);
      c.add(graph.elements?.edges ?? []);
      window.setLanguage?.('en');
      window.buildCategoryFilter?.();
      window.buildPhaseFilter?.();
      window.applyTheme?.(localStorage.getItem('onexus.theme') ?? 'light');
      window.applyLayout?.('default');
      cy.fit(undefined, 50);
      window.setEdgeLabelVisibility?.(true);
      window.setNodeLabelVisibility?.(true);
    } catch (e) { console.error('Failed to load graph object:', e); alert('Failed to load graph: ' + e.message); }
  }
  function applyLayoutPositions(positions) {
    if (!Array.isArray(positions) || !positions.length) return;
    positions.forEach(p => {
      if (!p || !p.id) return;
      const n = cy.getElementById(p.id);
      if (n && n.nonempty && n.nonempty() && p.position && typeof p.position.x === 'number' && typeof p.position.y === 'number')
        n.position(p.position);
    });
    cy.fit(undefined, 50);
  }
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e) => {
      if (!e || !e.data) return;
      if (e.data.type === 'onexus-graph') { loadGraphObject(e.data.graph); return; }
      if (e.data.type === 'highlight-nodes') {
        const ids = new Set(e.data.ids ?? []);
        cy.nodes().removeClass('highlight');
        const hits = cy.nodes().filter(n => ids.has(n.id()));
        hits.addClass('highlight'); if (hits.nonempty && hits.nonempty()) cy.fit(hits, 60);
        return;
      }
      if (e.data.type === 'apply-layout') {
        const positions = e.data.positions ?? [];
        if (Array.isArray(positions) && positions.length) window.applyLayoutPositions(positions);
        return;
      }
    });
  }

  // expose
  window.loadJSON = loadJSON;
  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;
  window.onexusLoadGraph = loadGraphObject;
  window.applyLayoutPositions = applyLayoutPositions;
})();