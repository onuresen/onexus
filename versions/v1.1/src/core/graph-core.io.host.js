/* ONEXUS – IO Host & Validation (load/validate JSON, host bridge, apply positions)
   PATCHED for Revit exporter JSON (onexus-1.1, nodeType=Element, label.en only, etc.)
*/
(function () {
  const cy = window.cy;

  // ---- Normalization rules (tweak here if needed)
  const NODETYPE_MAP = {
    Element: "Component", // Revit exporter -> ONEXUS canonical
  };

  function ensureLabelObject(label, fallback) {
    // Accept: object {en,jp} OR string OR null
    if (label && typeof label === "object") {
      const en = String(label.en ?? fallback ?? "").trim() || String(fallback ?? "");
      const jp = String(label.jp ?? en).trim() || en;
      return { en, jp };
    }
    // string / undefined
    const en = String(label ?? fallback ?? "").trim() || String(fallback ?? "");
    return { en, jp: en };
  }

  function normalizeCategory(nodeData) {
    const id = String(nodeData.id ?? "");
    const revitCat = String(nodeData.revitCategory ?? "");
    const cat = String(nodeData.category ?? "").trim();

    // Doors: keep consistent for UX
    if (id.startsWith("DOOR-")) return "Door";

    // Components inside Doors families (your COMP-* are still Doors category in Revit)
    if (revitCat === "Doors") {
      // If category is missing OR equals "Doors" already OR looks wrong, normalize to "Doors"
      if (!cat) return "Doors";
      if (cat === "Doors") return "Doors";
      if (cat === "Door") return "Doors"; // components shouldn't be Door (instances are Door)
      return cat; // keep custom categories if you later add them
    }

    return cat || revitCat || "Uncategorized";
  }

  function normalizeNode(nWrap) {
    const d0 = nWrap?.data ?? {};
    const id = String(d0.id ?? "").trim();
    const nodeTypeRaw = String(d0.nodeType ?? "").trim();
    const nodeType = NODETYPE_MAP[nodeTypeRaw] ?? (nodeTypeRaw || "Component");

    const label = ensureLabelObject(d0.label, d0.displayLabel ?? id);
    const displayLabel = (window.__onexus_state?.language === "jp")
      ? (label.jp ?? label.en ?? id)
      : (label.en ?? id);

    const category = normalizeCategory({ ...d0, id });

    return {
      data: {
        ...d0,
        id,
        nodeType,
        category,
        label,
        displayLabel,
      }
    };
  }

  function normalizeEdge(eWrap) {
    const d0 = eWrap?.data ?? {};
    const id = String(d0.id ?? "").trim();
    const type = String(d0.type ?? "").trim();
    const dimension = String(d0.dimension ?? "").trim();
    const source = String(d0.source ?? "").trim();
    const target = String(d0.target ?? "").trim();
    const directional = !!d0.directional;

    // displayType is computed by setLanguage(), but we can seed it
    const map = (window.__onexus_labels?.[window.__onexus_state?.language ?? "en"] ?? {});
    const displayType = d0.displayType ?? map[type] ?? type;

    return {
      data: {
        ...d0,
        id,
        type,
        dimension,
        source,
        target,
        directional,
        displayType
      }
    };
  }

  function normalizeGraph(graph) {
    const nodes = (graph?.elements?.nodes ?? []).map(normalizeNode);
    const edges = (graph?.elements?.edges ?? []).map(normalizeEdge);
    return {
      meta: graph?.meta ?? {},
      elements: { nodes, edges }
    };
  }

  // ---- Validator (kept strict, but allows label to be string/object; nodeType any string)
  function validateOnexusJson(data) {
    const errors = [];
    if (!data || !data.elements) {
      errors.push("Missing `elements`.");
      return { valid: false, errors };
    }
    if (!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if (!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");

    (data.elements.nodes ?? []).forEach((n, i) => {
      const d = n?.data ?? {};
      if (!d.id) errors.push(`nodes[${i}].data.id is required`);
      if (!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`);
      if (!d.category && !d.revitCategory) errors.push(`nodes[${i}].data.category or .revitCategory is required`);
      // label can be object OR string (Revit exporter might evolve)
      if (!(typeof d.label === "object" || typeof d.label === "string")) {
        errors.push(`nodes[${i}].data.label must be an object or string`);
      }
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

  // ---- File input: load a single ONEXUS JSON file
  function loadJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      let raw;
      try {
        raw = JSON.parse(e.target.result);
      } catch (err) {
        alert("Invalid JSON: " + err.message);
        return;
      }

      const { valid, errors } = validateOnexusJson(raw);
      if (!valid) {
        alert("Schema errors:\n" + errors.join("\n"));
        return;
      }

      const data = normalizeGraph(raw);

      window.__onexus_meta = data.meta ?? {};

      cy.elements().remove();
      cy.add(data.elements.nodes);
      cy.add(data.elements.edges);

      // keep existing pipeline
      const lang = window.__onexus_state?.language ?? (raw?.meta?.languageDefault ?? "en");
      window.setLanguage?.(lang);
      window.buildCategoryFilter?.();
      window.applyTheme?.(localStorage.getItem("onexus.theme") ?? "light");
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

  // ---- Host integration: load graph object (used by unified loader & compare)
  function loadGraphObject(graph) {
    try {
      const res = validateOnexusJson(graph);
      if (res && res.valid === false) {
        console.error("ONEXUS schema errors:", res.errors);
        alert("Invalid ONEXUS JSON:\n" + res.errors.join("\n"));
        return;
      }

      const c = window.cy;
      if (!c) {
        console.error("Cytoscape not ready");
        return;
      }

      const data = normalizeGraph(graph);

      window.__onexus_meta = data.meta ?? {};

      c.elements().remove();
      c.add(data.elements?.nodes ?? []);
      c.add(data.elements?.edges ?? []);

      const lang = window.__onexus_state?.language ?? (graph?.meta?.languageDefault ?? "en");
      window.setLanguage?.(lang);
      window.buildCategoryFilter?.();
      window.buildPhaseFilter?.();
      window.applyTheme?.(localStorage.getItem("onexus.theme") ?? "light");
      window.applyLayout?.("default");
      c.fit(undefined, 50);
      window.setEdgeLabelVisibility?.(true);
      window.setNodeLabelVisibility?.(true);
      window.buildRelationshipLegend?.();
      window.updateMetrics?.();
    } catch (e) {
      console.error("Failed to load graph object:", e);
      alert("Failed to load graph: " + e.message);
    }
  }

  // ---- Apply absolute positions from exported layout
  function applyLayoutPositions(positions) {
    if (!Array.isArray(positions) || !positions.length) return;
    positions.forEach(p => {
      if (!p || !p.id) return;
      const n = cy.getElementById(p.id);
      if (n && n.nonempty && n.nonempty() && p.position
        && typeof p.position.x === "number"
        && typeof p.position.y === "number") {
        n.position(p.position);
      }
    });
    cy.fit(undefined, 50);
  }

  // ---- WebView2 bridge (optional)
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener("message", (e) => {
      if (!e || !e.data) return;

      if (e.data.type === "onexus-graph") { loadGraphObject(e.data.graph); return; }

      if (e.data.type === "highlight-nodes") {
        const ids = new Set(e.data.ids ?? []);
        cy.nodes().removeClass("highlight");
        const hits = cy.nodes().filter(n => ids.has(n.id()));
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

  // expose
  window.loadJSON = loadJSON;
  window.onexusLoadGraph = loadGraphObject;
  window.applyLayoutPositions = applyLayoutPositions;
  window.validateOnexusJson = validateOnexusJson;

})();