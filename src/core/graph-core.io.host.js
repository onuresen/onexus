/* ONEXUS – IO Host & Validation (load/validate JSON, host bridge, apply positions)
 SET C PATCH:
 - Always run meta unification via ONEXUS.import.applyMeta()
 - Always normalize via ONEXUS.import.normalizeGraph()
 - Preserve graph.view -> meta.view (legacy + modern paths)
*/
(function () {
  const cy = window.cy;

  const NODETYPE_MAP = { Element: "Component" };

  function ensureLabelObject(label, fallback) {
    if (label && typeof label === "object") {
      const en = String(label.en ?? fallback ?? "").trim() || String(fallback ?? "");
      const jp = String(label.jp ?? en).trim() || en;
      return { en, jp };
    }
    const en = String(label ?? fallback ?? "").trim() || String(fallback ?? "");
    return { en, jp: en };
  }

  function normalizeCategory(nodeData) {
    const id = String(nodeData.id ?? "");
    const revitCat = String(nodeData.revitCategory ?? "");
    const cat = String(nodeData.category ?? "").trim();
    if (id.startsWith("DOOR-")) return "Door";
    if (revitCat === "Doors") {
      if (!cat) return "Doors";
      if (cat === "Doors") return "Doors";
      if (cat === "Door") return "Doors";
      return cat;
    }
    return cat || revitCat || "Uncategorized";
  }

  function normalizeNode(nWrap) {
    const d0 = nWrap?.data ?? {};
    const id = String(d0.id ?? "").trim();
    const nodeTypeRaw = String(d0.nodeType ?? "").trim();
    const nodeType = NODETYPE_MAP[nodeTypeRaw] ?? (nodeTypeRaw || "Component");
    const label = ensureLabelObject(d0.label, d0.displayLabel ?? id);

    const displayLabel =
      (window.__onexus_state?.language === "jp")
        ? (label.jp ?? label.en ?? id)
        : (label.en ?? id);

    const category = normalizeCategory({ ...d0, id });
    return { data: { ...d0, id, nodeType, category, label, displayLabel } };
  }

  function normalizeEdge(eWrap) {
    const d0 = eWrap?.data ?? {};
    const id = String(d0.id ?? "").trim();
    const type = String(d0.type ?? "").trim();
    const dimension = String(d0.dimension ?? "").trim();
    const source = String(d0.source ?? "").trim();
    const target = String(d0.target ?? "").trim();
    const directional = !!d0.directional;

    const map = window.__onexus_labels?.[window.__onexus_state?.language ?? "en"] ?? {};
    const displayType = d0.displayType ?? map[type] ?? type;

    return { data: { ...d0, id, type, dimension, source, target, directional, displayType } };
  }

  function mergeViewIntoMeta(meta, graph) {
    const m = meta && typeof meta === "object" ? { ...meta } : {};
    const rootView = graph?.view && typeof graph.view === "object" ? graph.view : null;

    let mv = {};
    if (typeof m.view === "string") mv.key = String(m.view);
    else if (m.view && typeof m.view === "object") mv = { ...m.view };

    if (rootView) mv = { ...mv, ...rootView };
    if (Object.keys(mv).length) m.view = mv;

    return m;
  }

  function normalizeGraphLegacy(graph) {
    const nodes = (graph?.elements?.nodes ?? []).map(normalizeNode);
    const edges = (graph?.elements?.edges ?? []).map(normalizeEdge);
    const meta = mergeViewIntoMeta(graph?.meta ?? {}, graph);
    return { meta, elements: { nodes, edges } };
  }

  function validateOnexusJson(data) {
    const errors = [];
    if (!data || !data.elements) {
      errors.push("Missing `elements`.");
      return { valid: false, errors };
    }
    if (!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");

    const nodeIds = new Set();
    (data.elements.nodes ?? []).forEach((n, i) => {
      const d = n?.data ?? {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      else nodeIds.add(d.id);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category && !d.revitCategory) errors.push(`nodes[${i}].data.category or .revitCategory is required`);
      if (!(typeof d.label === "object" || typeof d.label === "string")) errors.push(`nodes[${i}].data.label must be an object or string`);
    });

    (data.elements.edges ?? []).forEach((e, i) => {
      const d = e?.data ?? {};
      if (!d.id) errors.push(`edges[${i}].data.id is required`);
      if (!d.type) errors.push(`edges[${i}].data.type is required`);
      if (!d.dimension) errors.push(`edges[${i}].data.dimension is required`);
      if (!d.source) errors.push(`edges[${i}].data.source is required`);
      else if (nodeIds.size && !nodeIds.has(d.source)) errors.push(`edges[${i}].data.source "${d.source}" references unknown node`);
      if (!d.target) errors.push(`edges[${i}].data.target is required`);
      else if (nodeIds.size && !nodeIds.has(d.target)) errors.push(`edges[${i}].data.target "${d.target}" references unknown node`);
      if (typeof d.directional !== "boolean") errors.push(`edges[${i}].data.directional must be boolean`);
    });

    return { valid: errors.length === 0, errors };
  }

  function loadJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      let raw;
      try { raw = JSON.parse(e.target.result); }
      catch (err) { alert("Invalid JSON: " + err.message); return; }

      const { valid, errors } = validateOnexusJson(raw);
      if (!valid) { alert("Schema errors:\n" + errors.join("\n")); return; }

      // ✅ Set C: unify meta + normalize via ONEXUS.import if available
      try { window.ONEXUS?.bus?.emit?.("graphWillLoad", { graph: raw }); } catch { }

      let graph = raw;
      try {
        const applyMeta = window.ONEXUS?.import?.applyMeta;
        const norm = window.ONEXUS?.import?.normalizeGraph;
        if (typeof applyMeta === "function") {
          graph = applyMeta(graph, { importer: "json", sourceFiles: [file.name], sourceKind: "import" });
        }
        if (typeof norm === "function") {
          graph = norm(graph, { importer: graph?.meta?.importer ?? "json", sourceFiles: graph?.meta?.sourceFiles ?? [file.name], sourceKind: "import" });
        } else {
          graph = normalizeGraphLegacy(graph);
        }
      } catch (err) {
        console.warn("[ONEXUS] normalize/applyMeta failed (fallback legacy):", err);
        graph = normalizeGraphLegacy(raw);
      }

      window.__onexus_meta = graph.meta ?? {};
      window.___onexus_meta = window.___onexus_meta || window.__onexus_meta;

      cy.elements().remove();
      cy.add(graph.elements.nodes);
      cy.add(graph.elements.edges);

      const lang = window.__onexus_state?.language ?? (raw?.meta?.languageDefault ?? "en");
      window.setLanguage?.(lang);
      window.buildCategoryFilter?.();
      window.applyTheme?.(localStorage.getItem("onexus.theme") ?? "light");
      window.buildPhaseFilter?.();
      window.applyLayout?.("default");
      cy.fit(undefined, 50);

      const perfHide = window.ONEXUS_PERF?.isTempLabelHide?.() === true;
      if (!perfHide) {
        window.setEdgeLabelVisibility?.(true);
        window.setNodeLabelVisibility?.(true);
      }

      window.buildRelationshipLegend?.();
      window.updateMetrics?.();

      try {
        window.ONEXUS?.bus?.emit?.("graphLoaded", {
          graph,
          meta: window.__onexus_meta,
          counts: { nodes: cy.nodes().length, edges: cy.edges().length },
        });
      } catch { }
    };
    reader.readAsText(file);
  }

  function loadGraphObject(graph) {
    try {
      try { window.ONEXUS?.bus?.emit?.("graphWillLoad", { graph }); } catch { }

      // ✅ Set C: always apply meta + normalize if available
      let g = graph;
      try {
        const applyMeta = window.ONEXUS?.import?.applyMeta;
        const norm = window.ONEXUS?.import?.normalizeGraph;

        const sourceFiles = Array.isArray(g?.meta?.sourceFiles) ? g.meta.sourceFiles : [];
        if (typeof applyMeta === "function") {
          g = applyMeta(g, {
            importer: g?.meta?.importer ?? "onexusLoadGraph",
            sourceFiles,
            sourceKind: g?.meta?.sourceKind ?? "import",
            mode: g?.meta?.mode ?? "",
          });
        }
        if (typeof norm === "function") {
          g = norm(g, {
            importer: g?.meta?.importer ?? "onexusLoadGraph",
            sourceFiles,
            sourceKind: g?.meta?.sourceKind ?? "import",
            mode: g?.meta?.mode ?? "",
          });
        } else {
          g = normalizeGraphLegacy(g);
        }
      } catch (e) {
        console.warn("[ONEXUS] import normalization failed (continuing):", e);
        g = normalizeGraphLegacy(graph);
      }

      const res = validateOnexusJson(g);
      if (res && res.valid === false) {
        console.error("ONEXUS schema errors:", res.errors);
        alert("Invalid ONEXUS JSON:\n" + res.errors.join("\n"));
        try { window.ONEXUS?.bus?.emit?.("graphLoadFailed", { graph: g, errors: res.errors }); } catch { }
        return;
      }

      const c = window.cy;
      if (!c) {
        console.error("Cytoscape not ready");
        try { window.ONEXUS?.bus?.emit?.("graphLoadFailed", { graph: g, errors: ["Cytoscape not ready"] }); } catch { }
        return;
      }

      window.__onexus_meta = g.meta ?? {};
      window.___onexus_meta = window.___onexus_meta || window.__onexus_meta;

      c.elements().remove();
      c.add(g.elements?.nodes ?? []);
      c.add(g.elements?.edges ?? []);

      const lang = window.__onexus_state?.language ?? (g?.meta?.languageDefault ?? "en");
      window.setLanguage?.(lang);
      window.buildCategoryFilter?.();
      window.buildPhaseFilter?.();
      window.applyTheme?.(localStorage.getItem("onexus.theme") ?? "light");
      window.applyLayout?.("default");
      c.fit(undefined, 50);

      const perfHide = window.ONEXUS_PERF?.isTempLabelHide?.() === true;
      if (!perfHide) {
        window.setEdgeLabelVisibility?.(true);
        window.setNodeLabelVisibility?.(true);
      }

      window.buildRelationshipLegend?.();
      window.updateMetrics?.();

      try {
        window.ONEXUS?.bus?.emit?.("graphLoaded", {
          graph: g,
          meta: window.__onexus_meta,
          counts: { nodes: c.nodes().length, edges: c.edges().length },
        });
      } catch { }
    } catch (e) {
      console.error("Failed to load graph object:", e);
      alert("Failed to load graph: " + e.message);
      try { window.ONEXUS?.bus?.emit?.("graphLoadFailed", { graph, error: e }); } catch { }
    }
  }

  function applyLayoutPositions(positions) {
    if (!Array.isArray(positions) || !positions.length) return;
    positions.forEach((p) => {
      if (!p || !p.id) return;
      const n = cy.getElementById(p.id);
      if (
        n && n.nonempty && n.nonempty() &&
        p.position && typeof p.position.x === "number" && typeof p.position.y === "number"
      ) n.position(p.position);
    });
    cy.fit(undefined, 50);
  }

  // Host bridge (WebView2)
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener("message", (e) => {
      if (!e || !e.data) return;

      if (e.data.type === "onexus-graph") { loadGraphObject(e.data.graph); return; }

      if (e.data.type === "highlight-nodes") {
        const ids = new Set(e.data.ids ?? []);
        cy.nodes().removeClass("highlight");
        const hits = cy.nodes().filter((n) => ids.has(n.id()));
        hits.addClass("highlight");
        if (hits.nonempty && hits.nonempty()) cy.fit(hits, 60);
        return;
      }

      if (e.data.type === "apply-layout") {
        const positions = e.data.positions ?? [];
        if (Array.isArray(positions) && positions.length) window.applyLayoutPositions(positions);
        return;
      }
    });
  }

  window.loadJSON = loadJSON;
  window.onexusLoadGraph = loadGraphObject;
  window.applyLayoutPositions = applyLayoutPositions;
  window.validateOnexusJson = validateOnexusJson;
})();