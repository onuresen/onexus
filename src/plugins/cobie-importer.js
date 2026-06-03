/* ===============================
 ONEXUS – COBie CSV Importer (browser, no deps)
 Maps COBie sheets to ONEXUS graph.

 SET C PATCH:
 - Apply canonical meta via ONEXUS.import.applyMeta() before load
=============================== */
(function () {
  const norm = s => String(s ?? "").trim();
  const lc = s => norm(s).toLowerCase();
  const idSafe = s => norm(s).replace(/[^\w\-:.]+/g, "_");

  // Count a delimiter's occurrences in a line, ignoring anything inside quotes.
  function countOutsideQuotes(line, delim) {
    let n = 0, inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === delim && !inQ) n++;
    }
    return n;
  }

  // Pick the delimiter that splits the sampled lines most *consistently*
  // (same column count per line), not just the one with the most raw chars —
  // that avoids garbling on near-ties (e.g. 50 commas vs 51 semicolons).
  function detectDelimiter(lines) {
    const candidates = [",", ";", "\t"];
    let best = ",", bestScore = -Infinity;
    for (const d of candidates) {
      const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((_, i) => lines[i] !== "");
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) continue; // delimiter not present at all
      // consistency: how many lines share the modal count
      const freq = {};
      counts.forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
      const consistency = Math.max(...Object.values(freq)) / counts.length;
      // favour consistency, then total count; comma wins exact ties (loop order)
      const score = consistency * 1000 + total;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function parseCSV(text) {
    if (!text) return [];
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const sample = text.split("\n").filter((l) => l.trim() !== "").slice(0, 8);
    const DELIM = detectDelimiter(sample.length ? sample : [text]);

    const rows = [];
    let i = 0, cur = "", row = [], inQuotes = false;

    while (i <= text.length) {
      const ch = text[i++];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === DELIM) { row.push(cur); cur = ""; }
        else if (ch === "\n" || ch === undefined) { row.push(cur); rows.push(row); row = []; cur = ""; }
        else cur += ch;
      }
    }
    if (row.length) rows.push(row);

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

  function buildOnexusFromCobie(sheets) {
    const Components = sheets.Component || [];
    const Types = sheets.Type || [];
    const Systems = sheets.System || [];
    const Assembly = sheets.Assembly || [];
    const Spaces = sheets.Space || [];

    const typeByName = indexBy(Types, "name");
    const spaceByName = indexBy(Spaces, "name");

    const nodesMap = new Map();
    const edges = [];

    const normalizeCategory = (v) => {
      const s = norm(v);
      return s ? s : "Uncategorized";
    };

    function upsertNode(id, data) {
      if (!id) return null;
      const key = idSafe(id);

      if (!nodesMap.has(key)) {
        nodesMap.set(key, {
          data: {
            id: key,
            label: { en: String(id), jp: String(id) },
            displayLabel: String(id),
            nodeType: data.nodeType ?? "Component",
            category: normalizeCategory(data.category),
            level: data.level ?? "",
          },
        });
      }

      const d = nodesMap.get(key).data;
      Object.keys(data).forEach(k => { if (data[k] !== undefined && data[k] !== "") d[k] = data[k]; });
      d.category = normalizeCategory(d.category ?? d.revitCategory);

      if (d.label && typeof d.label === "object") d.displayLabel = d.label.en ?? d.displayLabel ?? d.id;

      return nodesMap.get(key);
    }

    function pushEdge({ id, type, source, target, dimension, directional = true, extra = {} }) {
      if (!source || !target) return;
      const eid = idSafe(id || `${type}:${source}->${target}`);
      edges.push({
        data: {
          id: eid,
          type,
          source: idSafe(source),
          target: idSafe(target),
          dimension,
          directional,
          displayType: type,
          ...extra,
        },
      });
    }

    // Spaces
    Spaces.forEach(s => {
      const name = norm(s.name);
      upsertNode(name, { nodeType: "Space", category: "Room" });
    });

    // Systems
    Systems.forEach(sys => {
      const name = norm(sys.name);
      const cat = norm(sys.category ?? sys["category-system"]);
      upsertNode(name, { nodeType: "System", category: cat || "BuildingSystem" });
    });

    // Types + Vendors / Designers
    Types.forEach(t => {
      const typeName = norm(t.name);
      const cat = norm(t["category-element"] ?? t["category"] ?? "");
      const designer = norm(t.designer ?? t["supplier"] ?? "");
      const mfr = norm(t.manufacturer ?? "");

      if (typeName) upsertNode(typeName, { nodeType: "ComponentType", category: cat || "Type" });

      if (mfr) {
        upsertNode(mfr, { nodeType: "Vendor", category: "SecurityVendor" });
        pushEdge({ type: "ProvidedBy", source: typeName, target: mfr, dimension: "Vendor" });
      }

      if (designer) {
        upsertNode(designer, { nodeType: "Organization", category: "DesignTeam" });
        pushEdge({ type: "DesignedBy", source: typeName, target: designer, dimension: "Responsibility" });
      }
    });

    // Components
    Components.forEach(c => {
      const name = norm(c.name ?? c.tag ?? c.assetidentifier);
      if (!name) return;

      const typeName = norm(c.typename);
      const catFromType = norm(typeByName.get(idSafe(typeName))?.["category-element"] ?? "");
      const explicitCat = norm(c["category-element"] ?? c.category ?? catFromType);
      const spaceName = norm(c.space);
      const level = norm(c.floorname ?? c.level ?? "");
      const mfrFallback = norm(typeByName.get(idSafe(typeName))?.manufacturer ?? "");

      let category = explicitCat;
      if (!category && /door/i.test(typeName || name)) category = "Door";
      if (!category) category = "Uncategorized";

      upsertNode(name, { nodeType: "Component", category, level });

      if (spaceName && spaceByName.has(idSafe(spaceName))) {
        pushEdge({ type: "LocatedIn", source: name, target: spaceName, dimension: "Spatial" });
      }

      if (typeName) {
        upsertNode(typeName, { nodeType: "ComponentType", category: explicitCat || "Type" });
        pushEdge({
          type: "OfType",
          source: name,
          target: typeName,
          dimension: "System",
          directional: false,
          extra: { confidence: "Inferred" },
        });
      }

      if (mfrFallback) {
        upsertNode(mfrFallback, { nodeType: "Vendor", category: "SecurityVendor" });
        pushEdge({ type: "ProvidedBy", source: name, target: mfrFallback, dimension: "Vendor" });
      }
    });

    // Assembly Parent/Child
    Assembly.forEach(a => {
      const parent = norm(a.parentname ?? a.parent);
      const child = norm(a.childname ?? a.child);
      if (!parent || !child) return;

      upsertNode(parent, { nodeType: "Component" });
      upsertNode(child, { nodeType: "Component" });

      pushEdge({ type: "PartOfSystem", source: parent, target: child, dimension: "System", directional: true });
    });

    const nodes = Array.from(nodesMap.values());
    return { elements: { nodes, edges } };
  }

  async function loadCOBieCSVs(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;

    const txts = await Promise.all(files.map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res({ name: f.name, text: e.target.result });
      r.onerror = rej;
      r.readAsText(f);
    })));

    const map = {};
    for (const { name, text } of txts) {
      const base = name.replace(/\.[cC][sS][vV]$/, "");
      const m = base.match(/(component|type|system|assembly|space)/i);
      const key = (m ? m[1] : base).toLowerCase();
      map[key.charAt(0).toUpperCase() + key.slice(1)] = parseCSV(text);
    }

    let graph = buildOnexusFromCobie(map);

    // ✅ Set C: canonical meta
    const applyMeta = window.ONEXUS?.import?.applyMeta;
    if (typeof applyMeta === "function") {
      graph = applyMeta(graph, {
        importer: "cobie",
        sourceFiles: files.map(f => f.name),
        sourceKind: "import",
        mode: "",
      });
    } else {
      graph.meta = {
        schema: "onexus",
        importer: "cobie",
        importedAt: new Date().toISOString(),
        sourceFiles: files.map(f => f.name),
        sourceKind: "import",
      };
    }

    window.onexusLoadGraph?.(graph);
  }

  window.ONEXUS_COBie = { parseCSV, buildOnexusFromCobie, loadCOBieCSVs };
  window.loadCOBieCSVs = loadCOBieCSVs;

  // Plugin registration
  (function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    ONX.registerPlugin({
      id: "cobie",
      title: "COBie CSV Importer",
      register(api) {
        api.registerImporter({
          id: "cobie",
          label: "COBie CSV (multi-file)",
          priority: 70,
          extensions: ["csv"],
          acceptMultiple: true,
          canHandleFiles: async (files) => {
            if (!files || !files.length) return false;
            const names = files.map(f => (f.name ?? "").toLowerCase());
            if (names.some(n => /component|type|system|space|assembly/i.test(n))) return true;

            if (files.length === 1) {
              const head = await files[0].slice(0, 8192).text();
              const h = head.toLowerCase();
              return h.includes("name") && (h.includes("createdby") || h.includes("sheetname") || h.includes("assetidentifier"));
            }
            return false;
          },
          importFiles: async (files) => {
            const fakeEvt = { target: { files } };
            await loadCOBieCSVs(fakeEvt);
          },
        });

        api.registerEdgeTypeLabels("DesignedBy", { en: "Designed By", jp: "設計担当" });
        api.registerEdgeTypeLabels("ProvidedBy", { en: "Provided By", jp: "提供元" });
        api.registerEdgeTypeLabels("LocatedIn", { en: "Located In", jp: "設置場所" });
        api.registerEdgeTypeLabels("PartOfSystem", { en: "Part Of System", jp: "システム構成" });
        api.registerEdgeTypeLabels("OfType", { en: "Of Type", jp: "形式" });
      },
    });
  })();
})();