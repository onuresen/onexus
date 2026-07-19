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
    const warnings = [];
    if (!data || !data.elements) {
      errors.push("Missing `elements`.");
      return { valid: false, errors, warnings, stats: { nodes: 0, edges: 0 } };
    }
    if (!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");

    const nodeIds = new Set();
    const referencedNodeIds = new Set();
    (data.elements.nodes ?? []).forEach((n, i) => {
      const d = n?.data ?? {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      else if (nodeIds.has(d.id)) errors.push(`nodes[${i}].data.id "${d.id}" is duplicated`);
      else nodeIds.add(d.id);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category && !d.revitCategory) errors.push(`nodes[${i}].data.category or .revitCategory is required`);
      if (!(typeof d.label === "object" || typeof d.label === "string")) errors.push(`nodes[${i}].data.label must be an object or string`);
    });

    const edgeIds = new Set();
    const truthClasses = new Set(["source-native", "governed", "project-defined", "inferred", "decision-created", "historical"]);
    (data.elements.edges ?? []).forEach((e, i) => {
      const d = e?.data ?? {};
      if (!d.id) errors.push(`edges[${i}].data.id is required`);
      else if (edgeIds.has(d.id)) errors.push(`edges[${i}].data.id "${d.id}" is duplicated`);
      else edgeIds.add(d.id);
      if (!d.type) errors.push(`edges[${i}].data.type is required`);
      if (!d.dimension) errors.push(`edges[${i}].data.dimension is required`);
      if (!d.source) errors.push(`edges[${i}].data.source is required`);
      else if (nodeIds.size && !nodeIds.has(d.source)) errors.push(`edges[${i}].data.source "${d.source}" references unknown node`);
      else referencedNodeIds.add(d.source);
      if (!d.target) errors.push(`edges[${i}].data.target is required`);
      else if (nodeIds.size && !nodeIds.has(d.target)) errors.push(`edges[${i}].data.target "${d.target}" references unknown node`);
      else referencedNodeIds.add(d.target);
      if (typeof d.directional !== "boolean") errors.push(`edges[${i}].data.directional must be boolean`);
      if (d.source && d.source === d.target) warnings.push(`edges[${i}] "${d.id || "(no id)"}" is a self-loop`);
      const truthClass = d.relationship?.truthClass ?? d.truthClass;
      if (truthClass && !truthClasses.has(String(truthClass).toLowerCase())) {
        warnings.push(`edges[${i}].data.relationship.truthClass "${truthClass}" is not canonical`);
      }
      if (d.relationship?.review?.status === "approved" && String(truthClass).toLowerCase() === "inferred") {
        warnings.push(`edges[${i}] "${d.id || "(no id)"}" is inferred but marked approved; promote it to governed or retain proposed review status`);
      }
    });

    const orphanIds = [...nodeIds].filter(id => !referencedNodeIds.has(id));
    if (orphanIds.length) {
      const preview = orphanIds.slice(0, 5).join(", ");
      warnings.push(`${orphanIds.length} orphan node${orphanIds.length === 1 ? "" : "s"} without relationships: ${preview}${orphanIds.length > 5 ? ", …" : ""}`);
    }
    if (nodeIds.size === 0) warnings.push("Graph contains no nodes.");

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        nodes: data.elements.nodes?.length ?? 0,
        edges: data.elements.edges?.length ?? 0,
        orphanNodes: orphanIds.length,
      },
    };
  }

  function publishValidation(result, graph) {
    window.ONEXUS_LAST_VALIDATION = result;
    if (result.warnings?.length) console.warn("[ONEXUS validation]", ...result.warnings);
    try { window.ONEXUS?.bus?.emit?.("graphValidated", { ...result, graph }); } catch { }
  }

  function loadJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      let raw;
      try { raw = JSON.parse(e.target.result); }
      catch (err) { alert("Invalid JSON: " + err.message); return; }

      const validation = validateOnexusJson(raw);
      const { valid, errors } = validation;
      publishValidation(validation, raw);
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
      publishValidation(res, g);
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

      // Pre-load sanity: surface empty results and guard against graphs large
      // enough to stall the browser (Cytoscape renders ~10k elements smoothly).
      const nodeCount = g.elements?.nodes?.length ?? 0;
      const edgeCount = g.elements?.edges?.length ?? 0;
      if (nodeCount === 0) {
        const msg = "Loaded 0 nodes — the file may be empty, unsupported, or failed to parse.";
        if (typeof window.showTransientMessage === "function") window.showTransientMessage(msg, 4000);
        else console.warn("[ONEXUS]", msg);
      }
      const LARGE_GRAPH = 10000;
      if (nodeCount + edgeCount > LARGE_GRAPH) {
        const proceed = window.confirm(
          `This graph has ${nodeCount.toLocaleString()} nodes and ${edgeCount.toLocaleString()} edges ` +
          `(${(nodeCount + edgeCount).toLocaleString()} elements). Rendering may be slow or unresponsive.\n\nLoad anyway?`
        );
        if (!proceed) {
          try { window.ONEXUS?.bus?.emit?.("graphLoadFailed", { graph: g, errors: ["Load cancelled by user (large graph)"] }); } catch { }
          return;
        }
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

  // ── applyGraphDelta ────────────────────────────────────────────────────
  //
  //  Applies an incremental update without a full graph reload.
  //  Called from the "graph-delta" WebView2 message and exposed as
  //  window.onexusApplyDelta for Playwright tests.
  //
  //  payload:
  //    nodes   — array of Onexus node wrappers to add or update
  //    edges   — array of Onexus edge wrappers to add or update
  //    removed — array of node UniqueIds to remove (with their incident edges)
  // ─────────────────────────────────────────────────────────────────────────
  function applyGraphDelta({ nodes = [], edges = [], removed = [] }) {
    const c = window.cy;
    if (!c) return;

    // 1. Remove deleted elements (cy.remove also removes incident edges)
    removed.forEach((id) => {
      const el = c.getElementById(id);
      if (el && el.nonempty && el.nonempty()) el.remove();
    });

    // 2. Upsert nodes — normalise before touching the graph
    nodes.forEach((nWrap) => {
      try {
        const norm = normalizeNode(nWrap);
        const existing = c.getElementById(norm.data.id);
        if (existing.nonempty && existing.nonempty()) {
          existing.data(norm.data); // update in place
        } else {
          c.add({ group: "nodes", data: norm.data });
        }
      } catch { /* skip malformed node */ }
    });

    // 3. Upsert edges — skip if source or target are not in the graph
    edges.forEach((eWrap) => {
      try {
        const norm = normalizeEdge(eWrap);
        const existing = c.getElementById(norm.data.id);
        if (existing.nonempty && existing.nonempty()) {
          existing.data(norm.data);
        } else {
          // Cytoscape throws if source/target nodes are missing
          if (c.getElementById(norm.data.source).nonempty() &&
              c.getElementById(norm.data.target).nonempty()) {
            c.add({ group: "edges", data: norm.data });
          }
        }
      } catch { /* skip malformed edge */ }
    });

    // 4. Refresh lightweight UI components — no full layout recalculation
    try { window.buildCategoryFilter?.(); }    catch { }
    try { window.buildRelationshipLegend?.(); } catch { }
    try { window.updateMetrics?.(); }           catch { }

    try {
      window.ONEXUS?.bus?.emit?.("graphLoaded", {
        delta: true,
        counts: { nodes: c.nodes().length, edges: c.edges().length },
      });
    } catch { }
  }

  window.onexusApplyDelta = applyGraphDelta;

  // Host bridge (WebView2) ─────────────────────────────────────────────────
  //
  //  Inbound messages from Revit (C# → JS):
  //    highlight-nodes  { ids: string[], fitView?: bool }
  //      Highlights nodes whose id matches a Revit UniqueId.
  //      fitView defaults to true; pass false to highlight without panning.
  //
  //    zoom-to-node  { id: string }
  //      Highlights a single node and fits the camera to it.
  //
  //    clear-highlight  {}
  //      Removes all .highlight classes.
  //
  //    graph-delta  { nodes, edges, removed }
  //      Incremental update — adds/updates/removes nodes without a full reload.
  //
  //    graph-delta-overflow  { count }
  //      Too many changes for delta — signals the JS side to show a hint.
  //
  //    onexus-graph  { graph: object }
  //      Loads a full graph object (legacy / direct-injection path).
  //
  //    apply-layout  { positions: [{id, position}] }
  //      Restores saved positions.
  // ─────────────────────────────────────────────────────────────────────────
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener("message", (e) => {
      if (!e || !e.data) return;

      // ── Full graph load ──────────────────────────────────────────────────
      if (e.data.type === "onexus-graph") {
        loadGraphObject(e.data.graph);
        return;
      }

      // ── Highlight nodes from Revit selection ─────────────────────────────
      if (e.data.type === "highlight-nodes") {
        const ids     = new Set(e.data.ids ?? []);
        const fitView = e.data.fitView !== false; // default true

        cy.nodes().removeClass("highlight");
        if (ids.size === 0) return;

        const hits = cy.nodes().filter((n) => ids.has(n.id()));
        hits.addClass("highlight");

        if (fitView && hits.nonempty && hits.nonempty()) {
          cy.animate({ fit: { eles: hits, padding: 60 }, duration: 300 });
        }
        return;
      }

      // ── Zoom camera to a single node (from "Zoom to in Revit" feedback) ─
      if (e.data.type === "zoom-to-node") {
        const node = cy.getElementById(e.data.id ?? "");
        if (node && node.nonempty && node.nonempty()) {
          cy.nodes().removeClass("highlight");
          node.addClass("highlight");
          cy.animate({ fit: { eles: node, padding: 80 }, duration: 300 });
        }
        return;
      }

      // ── Remove all highlights ────────────────────────────────────────────
      if (e.data.type === "clear-highlight") {
        cy.nodes().removeClass("highlight");
        return;
      }

      // ── Incremental delta update ─────────────────────────────────────────
      if (e.data.type === "graph-delta") {
        applyGraphDelta({
          nodes:   e.data.nodes   ?? [],
          edges:   e.data.edges   ?? [],
          removed: e.data.removed ?? [],
        });
        return;
      }

      // ── Delta overflow: too many elements changed — hint to resync ────────
      if (e.data.type === "graph-delta-overflow") {
        const count = e.data.count ?? "many";
        console.warn(
          `[ONEXUS] ${count} elements changed in one transaction — delta skipped. ` +
          "Run a Sync command to refresh the graph."
        );
        try { window.ONEXUS?.bus?.emit?.("revitDeltaOverflow", { count }); } catch { }
        return;
      }

      // ── Layout restore ───────────────────────────────────────────────────
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
