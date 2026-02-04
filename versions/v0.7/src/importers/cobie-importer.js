/* ===============================
   ONEXUS – COBie CSV Importer (browser, no deps)
   Maps COBie sheets to ONEXUS graph:
   - Nodes: Component, System, Space, Vendor, Organization (Designer), Type(optional)
   - Edges:
       Component -> Space              type: LocatedIn       dimension: Spatial
       Component -> System             type: PartOfSystem    dimension: System
       Parent(Assembly) -> Child       type: PartOfSystem    dimension: System
       Component -> Vendor(Manufacturer) type: ProvidedBy    dimension: Vendor
       Component/Type -> Organization(Designer) type: DesignedBy dimension: Responsibility
   ================================== */

(function () {
  // --- Small utilities ---
  const norm = s => String(s ?? "").trim();
  const lc   = s => norm(s).toLowerCase();
  const idSafe = s => norm(s).replace(/[^\w\-:.]+/g, "_");

  function detectDelimiter(firstLine) {
    const c = (firstLine.match(/,/g) || []).length;
    const s = (firstLine.match(/;/g) || []).length;
    const t = (firstLine.match(/\t/g) || []).length;
    if (t >= c && t >= s) return "\t";
    if (c >= s) return ",";
    return ";";
  }

  // Robust-enough CSV parser for COBie sheets (quotes, escapes, multi-delims)
  function parseCSV(text) {
    if (!text) return [];
    // Normalize newlines
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const firstNL = text.indexOf("\n");
    const headLine = firstNL >= 0 ? text.slice(0, firstNL) : text;
    const DELIM = detectDelimiter(headLine);

    const rows = [];
    let i = 0, cur = "", row = [], inQuotes = false;
    while (i <= text.length) {
      const ch = text[i++];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i] === '"') { cur += '"'; i++; } else { inQuotes = false; }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === DELIM) { row.push(cur); cur = ""; }
        else if (ch === "\n" || ch === undefined) { row.push(cur); rows.push(row); row = []; cur = ""; }
        else { cur += ch; }
      }
    }
    if (row.length) rows.push(row);

    // headers -> objects
    const headers = (rows.shift() || []).map(h => lc(h).replace(/\s+/g, ""));
    return rows
      .filter(r => r.some(c => norm(c)))
      .map(r => {
        const o = {};
        headers.forEach((h, idx) => (o[h] = r[idx] ?? ""));
        return o;
      });
  }

  function indexBy(arr, key) {
    const map = new Map();
    arr.forEach(o => { const k = idSafe(o[key] ?? ""); if (k) map.set(k, o); });
    return map;
  }

  // --- COBie -> ONEXUS graph ---
  function buildOnexusFromCobie(sheets) {
    // Sheets come as arrays of objects with lowercase, spaceless headers
    const Components = sheets.Component || [];
    const Types      = sheets.Type || [];
    const Systems    = sheets.System || [];
    const Assembly   = sheets.Assembly || [];
    const Spaces     = sheets.Space || [];

    // Helpful lookups
    const typeByName = indexBy(Types, "name");
    const systemByName = indexBy(Systems, "name");
    const spaceByName = indexBy(Spaces, "name");

    const nodesMap = new Map();
    const edges = [];

    function upsertNode(id, data) {
      if (!id) return null;
      const key = idSafe(id);
      if (!nodesMap.has(key)) {
        nodesMap.set(key, {
          data: {
            id: key,
            label: { en: String(id), jp: String(id) },
            displayLabel: String(id),
            nodeType: data.nodeType || "Component",
            category: data.category || "",
            level: data.level || "",
          }
        });
      }
      // Shallow-merge data fields
      const d = nodesMap.get(key).data;
      Object.keys(data).forEach(k => {
        if (data[k] !== undefined && data[k] !== "") d[k] = data[k];
      });
      return nodesMap.get(key);
    }

    function pushEdge({ id, type, source, target, dimension, directional = true, extra = {} }) {
      if (!source || !target) return;
      const eid = idSafe(id || `${type}:${source}->${target}`);
      edges.push({
        data: {
          id: eid, type, source: idSafe(source), target: idSafe(target),
          dimension, directional, displayType: type, ...extra
        }
      });
    }

    // --- Spaces ---
    Spaces.forEach(s => {
      const name = norm(s.name);
      upsertNode(name, { nodeType: "Space", category: "Room" });
    });

    // --- Systems ---
    Systems.forEach(sys => {
      const name = norm(sys.name);
      const cat  = norm(sys.category ?? sys["category-system"]);
      upsertNode(name, { nodeType: "System", category: cat || "BuildingSystem" });
    });

    // --- Types + Vendors / Designers ---
    Types.forEach(t => {
      const typeName = norm(t.name);
      const cat = norm(t["category-element"] ?? t["category"] ?? "");
      const designer = norm(t.designer ?? t["supplier"] ?? "");
      const mfr = norm(t.manufacturer ?? "");
      // optional: treat type as a node if you want to visualize catalogs
      if (typeName) upsertNode(typeName, { nodeType: "ComponentType", category: cat || "Type" });

      if (mfr) {
        upsertNode(mfr, { nodeType: "Vendor", category: "SecurityVendor" });
        // edge Type -> Vendor (ProvidedBy)
        pushEdge({
          type: "ProvidedBy", source: typeName, target: mfr, dimension: "Vendor"
        });
      }
      if (designer) {
        upsertNode(designer, { nodeType: "Organization", category: "DesignTeam" });
        // edge Type -> Designer (DesignedBy)
        pushEdge({
          type: "DesignedBy", source: typeName, target: designer, dimension: "Responsibility"
        });
      }
    });

    // --- Components (main actors, e.g., Doors, Devices, etc.) ---
    Components.forEach(c => {
      const name = norm(c.name || c.tag || c.assetidentifier);
      if (!name) return;

      // Try to infer category and nodeType
      const typeName = norm(c.typename);
      const catFromType = norm(typeByName.get(idSafe(typeName))?.["category-element"] ?? "");
      const explicitCat = norm(c["category-element"] ?? c.category ?? catFromType);
      const spaceName = norm(c.space);
      const level = norm(c.floorname || c.level || "");
      const mfrFallback = norm(typeByName.get(idSafe(typeName))?.manufacturer ?? "");

      // Simple category heuristics for common cases (Doors/Hardware)
      let category = explicitCat;
      if (!category && /door/i.test(typeName || name)) category = "Door";
      if (!category) category = "Uncategorized";

      // Node
      upsertNode(name, {
        nodeType: "Component",
        category,
        level
      });

      // Component -> Space
      if (spaceName && spaceByName.has(idSafe(spaceName))) {
        pushEdge({
          type: "LocatedIn",
          source: name, target: spaceName,
          dimension: "Spatial"
        });
      }

      // Component -> Type (optional view)
      if (typeName) {
        upsertNode(typeName, { nodeType: "ComponentType", category: explicitCat || "Type" });
        pushEdge({
          type: "PartOfSystem", // treat "belongs-to-type" as weak system membership
          source: name, target: typeName,
          dimension: "System", directional: false,
          extra: { confidence: "Inferred" }
        });
      }

      // Vendor from Type.Manufacturer (fallback)
      if (mfrFallback) {
        upsertNode(mfrFallback, { nodeType: "Vendor", category: "SecurityVendor" });
        pushEdge({
          type: "ProvidedBy", source: name, target: mfrFallback, dimension: "Vendor"
        });
      }
    });

    // --- Assembly (Parent/Child) ---
    Assembly.forEach(a => {
      const parent = norm(a.parentname ?? a.parent);
      const child  = norm(a.childname ?? a.child);
      if (!parent || !child) return;
      // Ensure nodes exist
      upsertNode(parent, { nodeType: "Component" });
      upsertNode(child,  { nodeType: "Component" });
      // Parent -> Child
      pushEdge({
        type: "PartOfSystem", source: parent, target: child, dimension: "System", directional: true
      });
    });

    // --- System membership via Component.System (if present in your COBie) ---
    // Some COBie exports include a "System" column in Component or a separate mapping—support a comma/list.
    Components.forEach(c => {
      const comp = norm(c.name || c.tag);
      const sysCol = norm(c.system || c["systemname"] || "");
      if (!comp || !sysCol) return;
      sysCol.split(/[;,]+/).map(s => norm(s)).filter(Boolean).forEach(sName => {
        upsertNode(sName, { nodeType: "System", category: "BuildingSystem" });
        pushEdge({
          type: "PartOfSystem", source: comp, target: sName, dimension: "System", directional: false
        });
      });
    });

    // Build arrays
    const nodes = Array.from(nodesMap.values());
    return {
      elements: { nodes, edges }
    };
  }

  // ----- Public API for ONEXUS -----
  async function loadCOBieCSVs(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;

    // Read all as text
    const txts = await Promise.all(files.map(f => new Promise((res, rej) => {
      const r = new FileReader(); r.onload = e => res({ name: f.name, text: e.target.result });
      r.onerror = rej; r.readAsText(f);
    })));

    // map by normalized sheet name from filename
    const map = {};
    for (const { name, text } of txts) {
      const base = name.replace(/\.[cC][sS][vV]$/, "");
      const key = (base.match(/(component|type|system|assembly|space)/i)?.[1] || base).toLowerCase();
      map[key.charAt(0).toUpperCase() + key.slice(1)] = parseCSV(text);
    }

    const graph = buildOnexusFromCobie(map);
    if (typeof window.onexusLoadGraph === "function") {
      window.onexusLoadGraph(graph);
    } else if (window.cy) {
      // Fallback: direct injection
      window.cy.elements().remove();
      window.cy.add(graph.elements.nodes);
      window.cy.add(graph.elements.edges);
      window.setLanguage?.("en");
      window.buildCategoryFilter?.();
      window.applyLayout?.("default");
      window.cy.fit(undefined, 50);
    }
  }

  window.ONEXUS_COBie = { parseCSV, buildOnexusFromCobie, loadCOBieCSVs };
  window.loadCOBieCSVs = loadCOBieCSVs; // for graph-ui binding
})();