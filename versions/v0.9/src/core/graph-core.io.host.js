/* ONEXUS – IO Host & Validation (load/validate JSON, host bridge, apply positions) */
(function () {
  const cy = window.cy;

  // --- ONEXUS JSON validator (unchanged rules)
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

  // --- File input: load a single ONEXUS JSON file
  function loadJSON(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try { data = JSON.parse(e.target.result); } catch (err) { alert("Invalid JSON: " + err.message); return; }

      const { valid, errors } = validateOnexusJson(data);
      if (!valid) { alert("Schema errors:\n" + errors.join("\n")); return; }

      cy.elements().remove();
      cy.add(data.elements.nodes);
      cy.add(data.elements.edges);

      window.setLanguage?.(window.__onexus_state?.language ?? "en");
      window.buildCategoryFilter?.();
      window.applyTheme?.(localStorage.getItem('onexus.theme') ?? 'light');
      window.buildPhaseFilter?.();

      window.applyLayout?.("default");
      cy.fit(undefined, 50);

      window.setEdgeLabelVisibility?.(true);
      window.setNodeLabelVisibility?.(true);
      window.buildRelationshipLegend?.();
      window.updateMetrics?.();
    };
    reader.readAsText(file);
  }

  // --- Host integration: load graph object (used by unified loader & compare)
  function loadGraphObject(graph) {
    try {
      const res = validateOnexusJson(graph);
      if (res && res.valid === false) {
        console.error('ONEXUS schema errors:', res.errors);
        alert('Invalid ONEXUS JSON:\n' + res.errors.join('\n'));
        return;
      }
      const c = window.cy;
      if (!c) { console.error('Cytoscape not ready'); return; }

      c.elements().remove();
      c.add(graph.elements?.nodes ?? []);
      c.add(graph.elements?.edges ?? []);

      window.setLanguage?.('en');
      window.buildCategoryFilter?.();
      window.buildPhaseFilter?.();
      window.applyTheme?.(localStorage.getItem('onexus.theme') ?? 'light');
      window.applyLayout?.('default');
      cy.fit(undefined, 50);
      window.setEdgeLabelVisibility?.(true);
      window.setNodeLabelVisibility?.(true);
    } catch (e) {
      console.error('Failed to load graph object:', e);
      alert('Failed to load graph: ' + e.message);
    }
  }

  // --- Apply absolute positions from exported layout
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

  // --- WebView2 bridge (optional)
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
  window.onexusLoadGraph = loadGraphObject;
  window.applyLayoutPositions = applyLayoutPositions;
  window.validateOnexusJson = validateOnexusJson;
})();