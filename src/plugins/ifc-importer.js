/* ============================================
 ONEXUS — IFC Importer (Full Graph + IFCZIP), web-ifc/WASM
 - Pure browser, zero install, portable.
 - IFC: STEP text (.ifc) and IFCZIP (.ifczip with a .ifc entry)
 - web-ifc version-locked via CDN (JS+WASM): OpenModel(Uint8Array)

 FIXES (already in your file):
 - Stable IDs: GlobalId-first (fallback to expressID)
 - Always non-empty category for validator
 - Persist ifcExpressId / ifcGlobalId / ifcType on nodes

 SET C PATCH:
 - Canonical meta stamping via ONEXUS.import.applyMeta(graph, { importer, sourceFiles, sourceKind })
 - Single source of truth for import session stamping
 ============================================ */
const WEBIFC_BASE = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.44/";
(function () {
  let apiInstance = null;

  async function ensureIfcApi() {
    if (apiInstance) return apiInstance;

    const mod = await import(WEBIFC_BASE + "web-ifc-api.js");
    // Merge ALL exports (constants + classes) so type codes exist
    window.WebIFC = window.WebIFC || {};
    Object.assign(window.WebIFC, mod);

    const api = new window.WebIFC.IfcAPI();
    api.SetWasmPath(WEBIFC_BASE);
    await api.Init();
    api.SetLogLevel?.(3);

    apiInstance = api;
    return apiInstance;
  }

  // ---------- small utils ----------
  const idSafe = (s) => String(s ?? "").replace(/[^\w\-:.]+/g, "_");
  const asLabel = (s) => String(s ?? "").trim() || "(unnamed)";
  const itGet = (coll, i) => (typeof coll.get === "function" ? coll.get(i) : coll[i]);
  const itLen = (coll) =>
    coll
      ? typeof coll.size === "function"
        ? coll.size()
        : Array.isArray(coll)
          ? coll.length
          : coll.length ?? 0
      : 0;

  function* iterIds(coll) {
    const n = itLen(coll);
    for (let i = 0; i < n; i++) yield itGet(coll, i);
  }

  // Safe line fetch
  function getLineSafe(api, modelID, expressID) {
    try {
      return api.GetLine(modelID, expressID);
    } catch {
      return null;
    }
  }

  function getGlobalId(api, modelID, expressID) {
    const line = getLineSafe(api, modelID, expressID);
    const gid = line?.GlobalId?.value;
    return gid ? String(gid) : "";
  }

  function getIfcTypeName(api, modelID, expressID) {
    const line = getLineSafe(api, modelID, expressID);
    // web-ifc lines often expose `type` as a string (e.g., "IFCWALL")
    const t = line?.type ?? line?.__proto__?.constructor?.name;
    return t ? String(t) : "";
  }

  function labelOf(api, modelID, expressID) {
    const p = getLineSafe(api, modelID, expressID);
    return asLabel(p?.Name?.value ?? p?.GlobalId?.value ?? expressID);
  }

  function typeNameOf(api, modelID, expressID) {
    const line = getLineSafe(api, modelID, expressID);
    const isTypedBy = line?.IsTypedBy;
    if (Array.isArray(isTypedBy) && isTypedBy.length) {
      const rel = getLineSafe(api, modelID, isTypedBy[0].value);
      if (rel?.RelatingType) {
        const t = getLineSafe(api, modelID, rel.RelatingType.value);
        return asLabel(t?.Name?.value ?? t?.GlobalId?.value);
      }
    }
    return "";
  }

  // GlobalId-first ID mapping: expressID -> nodeId (stable)
  function makeNodeIdResolver(api, modelID, opt) {
    const cache = new Map(); // expressID -> nodeId
    return function nodeIdFor(expressID, prefix = "IFC") {
      const k = Number(expressID);
      if (!Number.isFinite(k) || k <= 0) return idSafe(`${prefix}_${expressID}`);
      if (cache.has(k)) return cache.get(k);

      let id = "";
      if (opt.useGlobalIdAsId) {
        const gid = getGlobalId(api, modelID, k);
        if (gid) id = `${prefix}_${gid}`; // stable
      }
      if (!id) id = `${prefix}_${k}`; // fallback: expressID
      id = idSafe(id);

      cache.set(k, id);
      return id;
    };
  }

  function normalizeCategory(v) {
    const s = String(v ?? "").trim();
    return s ? s : "Uncategorized";
  }

  function upsertNode(nodesMap, id, data) {
    const key = idSafe(id);
    if (!nodesMap.has(key)) {
      nodesMap.set(key, {
        data: {
          id: key,
          label: { en: String(data.displayLabel ?? key), jp: String(data.displayLabel ?? key) },
          displayLabel: String(data.displayLabel ?? key),
          nodeType: data.nodeType ?? "Component",
          category: normalizeCategory(data.category ?? data.revitCategory),
          level: data.level ?? "",
        },
      });
    }
    const d = nodesMap.get(key).data;

    // shallow merge (but keep category non-empty)
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v !== undefined && v !== "") d[k] = v;
    }
    d.category = normalizeCategory(d.category ?? d.revitCategory);

    // align displayLabel if label object exists
    if (d.label && typeof d.label === "object") {
      d.displayLabel = d.label.en ?? d.displayLabel ?? d.id;
    }
    return nodesMap.get(key);
  }

  function pushEdge(edges, { type, source, target, dimension, directional = true, extra = {} }) {
    if (!source || !target) return;
    const sid = idSafe(source);
    const tid = idSafe(target);
    const id = idSafe(`${type}:${sid}->${tid}:${edges.length + 1}`);
    edges.push({
      data: {
        id,
        type,
        source: sid,
        target: tid,
        dimension,
        directional: !!directional,
        displayType: type,
        ...extra,
      },
    });
  }

  // ---------- IFCZIP support (Stored/Deflated) ----------
  const SIG_EOCD = 0x06054b50; // End of central dir
  const SIG_CEN = 0x02014b50; // Central dir file header
  const SIG_LOC = 0x04034b50; // Local file header
  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);

  function findEOCD(u8) {
    const maxBack = Math.min(u8.byteLength, 0xffff + 22);
    const start = u8.byteLength - maxBack;
    const view = dv(u8);
    for (let off = u8.byteLength - 22; off >= start; off--) {
      if (u32(view, off) === SIG_EOCD) return off;
    }
    return -1;
  }

  function parseCentralDirectory(u8) {
    const offEOCD = findEOCD(u8);
    if (offEOCD < 0) throw new Error("ZIP: End of central directory not found.");
    const v = dv(u8);
    const totalEntries = u16(v, offEOCD + 10);
    const sizeCD = u32(v, offEOCD + 12);
    const offCD = u32(v, offEOCD + 16);

    let off = offCD;
    const entries = [];
    for (let i = 0; i < totalEntries; i++) {
      if (u32(v, off) !== SIG_CEN) break;

      const gpFlag = u16(v, off + 8);
      const compMethod = u16(v, off + 10);
      const compSize = u32(v, off + 20);
      const uncompSize = u32(v, off + 24);
      const fnLen = u16(v, off + 28);
      const extLen = u16(v, off + 30);
      const cmtLen = u16(v, off + 32);
      const relOffLH = u32(v, off + 42);

      const fnStart = off + 46;
      const fnEnd = fnStart + fnLen;
      const filename = new TextDecoder("utf-8").decode(u8.slice(fnStart, fnEnd));

      entries.push({ filename, gpFlag, compMethod, compSize, uncompSize, relOffLH });
      off = fnEnd + extLen + cmtLen;
      if (off > offCD + sizeCD) break;
    }
    return entries;
  }

  function parseLocalHeader(u8, relOffLH) {
    const v = dv(u8);
    if (u32(v, relOffLH) !== SIG_LOC) throw new Error("ZIP: Local header signature not found.");
    const gpFlag = u16(v, relOffLH + 6);
    const method = u16(v, relOffLH + 8);
    const fnLen = u16(v, relOffLH + 26);
    const extLen = u16(v, relOffLH + 28);
    const dataOff = relOffLH + 30 + fnLen + extLen;
    return { gpFlag, method, dataOff };
  }

  async function inflateRawDeflate(compressedU8) {
    if (typeof DecompressionStream !== "function") {
      throw new Error(
        "IFCZIP: Deflate not supported (DecompressionStream missing). Use Stored entries or Chromium/Edge."
      );
    }
    const stream = new Blob([compressedU8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function tryUnzipIFC(u8zip) {
    const entries = parseCentralDirectory(u8zip);
    const ifcEntries = entries
      .filter((e) => !e.filename.endsWith("/") && e.filename.toLowerCase().endsWith(".ifc"))
      .sort((a, b) => b.uncompSize - a.uncompSize);

    if (!ifcEntries.length) throw new Error("IFCZIP: No .ifc entry found inside archive.");
    const pick = ifcEntries[0];

    if (pick.gpFlag & 0x01) throw new Error("IFCZIP: Encrypted entries are not supported.");

    const loc = parseLocalHeader(u8zip, pick.relOffLH);
    const compSlice = u8zip.subarray(loc.dataOff, loc.dataOff + pick.compSize);

    if (loc.method === 0) return compSlice; // Stored
    if (loc.method === 8) return await inflateRawDeflate(compSlice); // Deflated
    throw new Error("IFCZIP: Unsupported compression method " + loc.method);
  }

  // ---------- main parse ----------
  async function parseIFCToOnexusGraph(arrayBuffer, options = {}) {
    const opt = {
      includeProperties: true,
      // When false (default) attach property sets and properties onto the element
      // node under `data.ifcProperties`. When true, preserve legacy behavior
      // of creating PropertySet nodes + HasProperties edges.
      includePropertiesAsNodes: false,
      includePorts: true,
      includeElementConnectivity: true,
      limitPropsPerPset: 8,
      capFallbackElements: 5000,
      useGlobalIdAsId: true, // ✅ stable IDs by default
      ...options,
    };

    const api = await ensureIfcApi();

    // Always coerce to Uint8Array
    let u8;
    if (arrayBuffer instanceof Uint8Array) u8 = arrayBuffer;
    else if (arrayBuffer instanceof ArrayBuffer) u8 = new Uint8Array(arrayBuffer);
    else if (typeof arrayBuffer?.buffer === "object" && arrayBuffer.byteLength !== undefined)
      u8 = new Uint8Array(arrayBuffer.buffer);
    else throw new Error("IFC loader: unsupported input type; expected Uint8Array/ArrayBuffer");

    // IFCZIP? -> extract .ifc
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      u8 = await tryUnzipIFC(u8);
    }

    // STEP preflight
    const size = u8.byteLength;
    if (!size || size < 20) throw new Error("IFC file is empty or too small (size < 20 bytes).");

    let headTxt = "";
    try {
      headTxt = new TextDecoder("utf-8", { fatal: false })
        .decode(u8.slice(0, Math.min(256, size)))
        .trimStart();
    } catch { }

    if (headTxt.startsWith("{")) throw new Error("IFCJSON detected. Provide STEP (.ifc) or IFCZIP with STEP .ifc.");
    if (!headTxt.includes("ISO-10303-21;")) throw new Error('Missing STEP header "ISO-10303-21;".');

    // Open model (regular + streaming fallback)
    const SETTINGS = {
      COORDINATE_TO_ORIGIN: true,
      CIRCLE_SEGMENTS: 16,
      MEMORY_LIMIT: 1024 * 1024 * 1024,
      TAPE_SIZE: 64 * 1024 * 1024,
    };

    let modelID = 0;
    try { modelID = api.OpenModel(u8, SETTINGS); } catch { }
    if (!modelID) {
      const reader = (offset, length) => u8.subarray(offset, offset + length);
      try { modelID = api.OpenModelFromCallback(reader, SETTINGS); } catch { }
    }
    if (!modelID) {
      const snippet = headTxt.slice(0, 120).replace(/\s+/g, " ");
      throw new Error('web-ifc OpenModel returned 0. Header: "' + snippet + '"');
    }

    const C = window.WebIFC;
    const {
      IFCBUILDING,
      IFCBUILDINGSTOREY,
      IFCSPACE,
      IFCZONE,
      IFCSYSTEM,
      IFCDISTRIBUTIONSYSTEM,
      IFCELEMENT,
      IFCPRODUCT,
      IFCDISTRIBUTIONPORT,
      IFCRELCONTAINEDINSPATIALSTRUCTURE,
      IFCRELAGGREGATES,
      IFCRELASSIGNSTOGROUP,
      IFCRELDEFINESBYTYPE,
      IFCRELDEFINESBYPROPERTIES,
      IFCRELVOIDSELEMENT,
      IFCRELFILLSELEMENT,
      IFCRELCONNECTSELEMENTS,
      IFCRELCONNECTSPORTS,
      IFCRELCONNECTSPORTTOELEMENT,
    } = C;

    // Stable ID resolver
    const nodeIdFor = makeNodeIdResolver(api, modelID, opt);

    const nodesMap = new Map();
    const edges = [];

    const idSet = (idsColl) => {
      const s = new Set();
      for (const id of iterIds(idsColl)) s.add(id);
      return s;
    };

    // Diagnostics
    const COUNT = (typecode) => {
      try {
        const ids = api.GetLineIDsWithType(modelID, typecode);
        return itLen(ids);
      } catch {
        return 0;
      }
    };

    (window.ONEXUS_LOG || console).table({
      Building: COUNT(IFCBUILDING),
      Storey: COUNT(IFCBUILDINGSTOREY),
      Space: COUNT(IFCSPACE),
      Zone: COUNT(IFCZONE),
      System: COUNT(IFCSYSTEM) + COUNT(IFCDISTRIBUTIONSYSTEM),
      Element_ifcElement: COUNT(IFCELEMENT),
      Product_ifcProduct: COUNT(IFCPRODUCT),
      RelContained: COUNT(IFCRELCONTAINEDINSPATIALSTRUCTURE),
      RelAggregates: COUNT(IFCRELAGGREGATES),
      RelAssignsToGroup: COUNT(IFCRELASSIGNSTOGROUP),
      RelDefinesByType: COUNT(IFCRELDEFINESBYTYPE),
      RelDefinesByProps: COUNT(IFCRELDEFINESBYPROPERTIES),
      RelVoids: COUNT(IFCRELVOIDSELEMENT),
      RelFills: COUNT(IFCRELFILLSELEMENT),
      RelConnectsElems: COUNT(IFCRELCONNECTSELEMENTS),
      Ports: COUNT(IFCDISTRIBUTIONPORT),
      RelConnectsPorts: COUNT(IFCRELCONNECTSPORTS),
      RelPortToElem: COUNT(IFCRELCONNECTSPORTTOELEMENT),
    });

    // Pre-materialize sets used for system/zone grouping
    const systemsSet = idSet(api.GetLineIDsWithType(modelID, IFCSYSTEM));
    const distsysSet = idSet(api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONSYSTEM));
    const zonesSet = idSet(api.GetLineIDsWithType(modelID, IFCZONE));

    // helper to attach IFC metadata to nodes consistently
    function upsertIfcNode(expressID, nodeType, category, displayLabelOverride) {
      const nid = nodeIdFor(expressID, "IFC");
      const name = displayLabelOverride ?? labelOf(api, modelID, expressID);
      const gid = getGlobalId(api, modelID, expressID);
      const ifcType = getIfcTypeName(api, modelID, expressID);

      upsertNode(nodesMap, nid, {
        nodeType,
        category,
        label: { en: name, jp: name },
        displayLabel: name,
        ifcExpressId: Number(expressID),
        ifcGlobalId: gid,
        ifcType,
      });
      return nid;
    }

    // ---------- Spatial nodes ----------
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCBUILDING))) upsertIfcNode(id, "Space", "Building");
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY))) upsertIfcNode(id, "Space", "Storey");
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCSPACE))) upsertIfcNode(id, "Space", "Room");
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCZONE))) upsertIfcNode(id, "Space", "Zone");

    // ---------- System nodes ----------
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCSYSTEM))) upsertIfcNode(id, "System", "BuildingSystem");
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONSYSTEM))) upsertIfcNode(id, "System", "BuildingSystem");

    // ---------- RelContainedInSpatialStructure -> LocatedIn ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE))) {
      const rel = getLineSafe(api, modelID, rid);
      const sId = rel?.RelatingStructure?.value;
      if (!sId) continue;

      const sNode = upsertIfcNode(sId, "Space", "Spatial");
      const related = rel?.RelatedElements ?? [];
      for (const r of related) {
        const eid = r.value;
        const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
        pushEdge(edges, { type: "LocatedIn", source: eNode, target: sNode, dimension: "Spatial", directional: true });

        try {
          const elemEntry = nodesMap.get(idSafe(eNode));
          const storeyEntry = nodesMap.get(idSafe(sNode));
          if (elemEntry && storeyEntry && storeyEntry.data && storeyEntry.data.displayLabel) {
            elemEntry.data.level = storeyEntry.data.displayLabel;
            elemEntry.data.nesting = elemEntry.data.nesting || {};
            elemEntry.data.nesting.level = storeyEntry.data.displayLabel;
            elemEntry.data.nesting.category = elemEntry.data.category;
            elemEntry.data.nesting.type = elemEntry.data.nodeType;
          }
        } catch { }
      }
    }

    // ---------- Aggregates -> PartOfSystem ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELAGGREGATES))) {
      const rel = getLineSafe(api, modelID, rid);
      const parent = rel?.RelatingObject?.value;
      const children = rel?.RelatedObjects ?? [];
      if (!parent || !children.length) continue;

      const pNode = upsertIfcNode(parent, "Component", "Assembly");
      for (const c of children) {
        const cid = c.value;
        const cNode = upsertIfcNode(cid, "Component", "BuiltElement");
        pushEdge(edges, { type: "PartOfSystem", source: pNode, target: cNode, dimension: "System", directional: true });
      }
    }

    // ---------- AssignsToGroup -> Systems / Zones ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELASSIGNSTOGROUP))) {
      const rel = getLineSafe(api, modelID, rid);
      const groupId = rel?.RelatingGroup?.value;
      const objs = rel?.RelatedObjects ?? [];
      if (!groupId || !objs.length) continue;

      const isSystem = systemsSet.has(groupId) || distsysSet.has(groupId);
      const isZone = zonesSet.has(groupId);
      if (!isSystem && !isZone) continue;

      const gNode = upsertIfcNode(groupId, isZone ? "Space" : "System", isZone ? "Zone" : "BuildingSystem");
      for (const o of objs) {
        const eid = o.value;
        const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
        if (isSystem) {
          pushEdge(edges, { type: "PartOfSystem", source: eNode, target: gNode, dimension: "System", directional: false });
        } else {
          pushEdge(edges, { type: "InZone", source: eNode, target: gNode, dimension: "Spatial", directional: false });
        }
      }
    }

    // ---------- DefinesByType -> OfType ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE))) {
      const rel = getLineSafe(api, modelID, rid);
      const tId = rel?.RelatingType?.value;
      const objs = rel?.RelatedObjects ?? [];
      if (!tId || !objs.length) continue;

      const tNode = upsertIfcNode(tId, "ComponentType", "Type");
      for (const o of objs) {
        const eid = o.value;
        const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
        pushEdge(edges, { type: "OfType", source: eNode, target: tNode, dimension: "System", directional: false });
      }
    }

    // ---------- DefinesByProperties -> HasProperties / inline ifcProperties ----------
    if (opt.includeProperties) {
      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES))) {
        const rel = getLineSafe(api, modelID, rid);
        const pRef = rel?.RelatingPropertyDefinition;
        const objs = rel?.RelatedObjects ?? [];
        if (!pRef || !objs.length) continue;

        const psetId = pRef.value;
        const pset = getLineSafe(api, modelID, psetId);
        const psetName = asLabel(pset?.Name?.value ?? `PSet_${psetId}`);

        const props = {};
        try {
          const pItems = pset?.HasProperties ?? [];
          for (let i = 0; i < Math.min(pItems.length, opt.limitPropsPerPset); i++) {
            const pid = pItems[i]?.value;
            const prop = pid ? getLineSafe(api, modelID, pid) : null;
            const pname = asLabel(prop?.Name?.value);
            const pval = prop?.NominalValue?.value ?? prop?.NominalValue?._text ?? "";
            if (pname) props[pname] = pval;
          }
        } catch { }

        if (opt.includePropertiesAsNodes) {
          let summary = psetName;
          try {
            const pairs = Object.keys(props)
              .slice(0, opt.limitPropsPerPset)
              .map((k) => `${k}${props[k] ? `=${props[k]}` : ""}`);
            if (pairs.length) summary = `${psetName}: ${pairs.join(", ")}`;
          } catch { }

          const pNode = upsertIfcNode(psetId, "PropertySet", "PropertySet", summary);
          for (const o of objs) {
            const eid = o.value;
            const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
            pushEdge(edges, { type: "HasProperties", source: eNode, target: pNode, dimension: "System", directional: false });
          }
        } else {
          for (const o of objs) {
            const eid = o.value;
            const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
            try {
              const entry = nodesMap.get(idSafe(eNode));
              if (entry && entry.data) {
                entry.data.ifcProperties = entry.data.ifcProperties || {};
                const existing = entry.data.ifcProperties[psetName] || {};
                entry.data.ifcProperties[psetName] = Object.assign({}, existing, props);
              }
            } catch { }
          }
        }
      }
    }

    // ---------- Openings ----------
    const openingToHost = new Map();
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT))) {
      const v = getLineSafe(api, modelID, rid);
      const opening = v?.RelatedOpeningElement?.value;
      const host = v?.RelatingBuildingElement?.value;
      if (opening && host) openingToHost.set(opening, host);
    }

    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT))) {
      const rel = getLineSafe(api, modelID, rid);
      const opening = rel?.RelatingOpeningElement?.value;
      const filler = rel?.RelatedBuildingElement?.value;
      if (!opening || !filler) continue;

      const fNode = upsertIfcNode(filler, "Component", "DoorLike");
      const host = openingToHost.get(opening);
      if (host) {
        const hNode = upsertIfcNode(host, "Component", "Wall");
        pushEdge(edges, { type: "FillsOpeningIn", source: fNode, target: hNode, dimension: "System", directional: true });
      }
    }

    // ---------- ConnectsElements ----------
    if (opt.includeElementConnectivity) {
      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSELEMENTS))) {
        const rel = getLineSafe(api, modelID, rid);
        const a = rel?.RelatingElement?.value;
        const b = rel?.RelatedElement?.value;
        if (!a || !b) continue;

        const aNode = upsertIfcNode(a, "Component", "BuiltElement");
        const bNode = upsertIfcNode(b, "Component", "BuiltElement");
        pushEdge(edges, { type: "ConnectsTo", source: aNode, target: bNode, dimension: "System", directional: false });
      }
    }

    // ---------- Ports ----------
    if (opt.includePorts) {
      for (const pid of iterIds(api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONPORT))) {
        upsertIfcNode(pid, "Port", "Port");
      }

      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSPORTS))) {
        const rel = getLineSafe(api, modelID, rid);
        const a = rel?.RelatingPort?.value;
        const b = rel?.RelatedPort?.value;
        if (!a || !b) continue;

        const aNode = upsertIfcNode(a, "Port", "Port");
        const bNode = upsertIfcNode(b, "Port", "Port");
        pushEdge(edges, { type: "ConnectsTo", source: aNode, target: bNode, dimension: "System", directional: false });
      }

      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSPORTTOELEMENT))) {
        const rel = getLineSafe(api, modelID, rid);
        const port = rel?.RelatingPort?.value;
        const elem = rel?.RelatedElement?.value;
        if (!port || !elem) continue;

        const pNode = upsertIfcNode(port, "Port", "Port");
        const eNode = upsertIfcNode(elem, "Component", "BuiltElement");
        pushEdge(edges, { type: "PortOf", source: pNode, target: eNode, dimension: "System", directional: true });
      }
    }

    // ---------- Opportunistic typing for elements (fallback enrichment) ----------
    const eleIds = api.GetLineIDsWithType(modelID, IFCELEMENT);
    for (const eid of iterIds(eleIds)) {
      const eNode = upsertIfcNode(eid, "Component", "BuiltElement");
      const tName = typeNameOf(api, modelID, eid);
      if (tName) {
        const tNode = idSafe(`IFC_TYPE_${tName}`);
        upsertNode(nodesMap, tNode, {
          nodeType: "ComponentType",
          category: "Type",
          label: { en: tName, jp: tName },
          displayLabel: tName,
        });
        pushEdge(edges, {
          type: "OfType",
          source: eNode,
          target: tNode,
          dimension: "System",
          directional: false,
          extra: { confidence: "Inferred" },
        });
      }
    }

    // ---------- FALLBACK A ----------
    if (nodesMap.size === 0) {
      console.warn("[ONEXUS/IFC] Fallback A: enumerating IFCELEMENT/IFCPRODUCT (no relations).");
      let list = api.GetLineIDsWithType(modelID, IFCELEMENT);
      if (!itLen(list)) list = api.GetLineIDsWithType(modelID, IFCPRODUCT);

      let count = 0;
      for (const id of iterIds(list)) {
        upsertIfcNode(id, "Component", "BuiltElement");
        count++;
        if (count >= opt.capFallbackElements) break;
      }
    }

    // ---------- FALLBACK B ----------
    if (nodesMap.size === 0) {
      try {
        console.warn("[ONEXUS/IFC] Fallback B: GetAllTypesOfModel() & IsIfcElement().");
        const types = api.GetAllTypesOfModel(modelID);
        let count = 0;
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          if (typeof api.IsIfcElement === "function" && !api.IsIfcElement(t)) continue;
          const ids = api.GetLineIDsWithType(modelID, t);
          for (const id of iterIds(ids)) {
            upsertIfcNode(id, "Component", "BuiltElement");
            count++;
            if (count >= opt.capFallbackElements) break;
          }
          if (count >= opt.capFallbackElements) break;
        }
      } catch (e) {
        console.warn("[ONEXUS/IFC] Fallback B failed:", e);
      }
    }

    // finalize
    const nodes = Array.from(nodesMap.values());
    console.info(`[ONEXUS/IFC] Built nodes=${nodes.length}, edges=${edges.length}.`);

    api.CloseModel(modelID);

    return { elements: { nodes, edges } };
  }

  // ---------- Set C: canonical meta stamping helper ----------
  function applyMetaIfAvailable(graph, { importer, sourceFiles, sourceKind = "import", mode = "" } = {}) {
    const applyMeta = window.ONEXUS?.import?.applyMeta;
    if (typeof applyMeta === "function") {
      return applyMeta(graph, {
        importer,
        sourceFiles: Array.isArray(sourceFiles) ? sourceFiles : [],
        sourceKind,
        mode,
      });
    }

    // fallback (no normalizer present)
    graph.meta = graph.meta || {};
    graph.meta.schema = graph.meta.schema || "onexus";
    graph.meta.importer = importer || "unknown";
    graph.meta.importedAt = graph.meta.importedAt || new Date().toISOString();
    graph.meta.sourceFiles = Array.isArray(sourceFiles) ? sourceFiles : [];
    graph.meta.sourceKind = sourceKind;
    graph.meta.mode = mode || "";
    return graph;
  }

  // ---------- UI glue ----------
  async function loadIFC(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;

    const file = files.find((f) => {
      const n = (f.name ?? "").toLowerCase();
      return n.endsWith(".ifc") || n.endsWith(".ifczip");
    });
    if (!file) return;

    const buf = await file.arrayBuffer();
    let graph = await parseIFCToOnexusGraph(buf);

    // ✅ Set C: canonical meta
    graph = applyMetaIfAvailable(graph, {
      importer: "ifc",
      sourceFiles: [file.name],
      sourceKind: "import",
      mode: "",
    });

    injectGraph(graph);
  }

  function injectGraph(graph) {
    if (typeof window.onexusLoadGraph === "function") {
      window.onexusLoadGraph(graph);
    } else if (window.cy) {
      const cy = window.cy;
      cy.elements().remove();
      cy.add(graph.elements.nodes);
      cy.add(graph.elements.edges);
      window.setLanguage?.("en");
      window.buildCategoryFilter?.();
      window.applyLayout?.("default");
      cy.fit(undefined, 50);
    }
  }

  // expose
  window.ONEXUS_IFC = { parseIFCToOnexusGraph, loadIFC };
})();

// ===============================
// ONEXUS Plugin Registration: IFC
// ===============================
(function () {
  const ONX = window.ONEXUS;
  if (!ONX || typeof ONX.registerPlugin !== "function") return;

  ONX.registerPlugin({
    id: "ifc",
    title: "IFC Importer",
    register(api) {
      api.registerImporter({
        id: "ifc",
        label: "IFC (.ifc / .ifczip)",
        priority: 90,
        extensions: ["ifc", "ifczip"],
        acceptMultiple: false,
        canHandleFiles: async (files) => {
          if (!files || files.length !== 1) return false;
          const n = (files[0].name ?? "").toLowerCase();
          return n.endsWith(".ifc") || n.endsWith(".ifczip");
        },
        importFiles: async (files) => {
          const f = files[0];

          // Preferred: use existing event-based loader (keeps behavior consistent)
          if (window.ONEXUS_IFC?.loadIFC) {
            const fakeEvt = { target: { files: [f] } };
            await window.ONEXUS_IFC.loadIFC(fakeEvt);
            return;
          }

          // Fallback: direct parse + meta + load
          const buf = await f.arrayBuffer();
          let graph = await window.ONEXUS_IFC.parseIFCToOnexusGraph(buf);

          const applyMeta = window.ONEXUS?.import?.applyMeta;
          if (typeof applyMeta === "function") {
            graph = applyMeta(graph, {
              importer: "ifc",
              sourceFiles: [f.name],
              sourceKind: "import",
              mode: "",
            });
          } else {
            graph.meta = graph.meta || {};
            graph.meta.schema = graph.meta.schema || "onexus";
            graph.meta.importer = "ifc";
            graph.meta.importedAt = new Date().toISOString();
            graph.meta.sourceFiles = [f.name];
            graph.meta.sourceKind = "import";
          }

          window.onexusLoadGraph?.(graph);
        },
      });

      // Optional: edge labels added by IFC
      api.registerEdgeTypeLabels("OfType", { en: "Of Type", jp: "形式" });
      api.registerEdgeTypeLabels("HasProperties", { en: "Has Properties", jp: "プロパティ有" });
      api.registerEdgeTypeLabels("InZone", { en: "In Zone", jp: "ゾーン所属" });
      api.registerEdgeTypeLabels("ConnectsTo", { en: "Connects To", jp: "接続" });
      api.registerEdgeTypeLabels("PortOf", { en: "Port Of", jp: "ポート所属" });
      api.registerEdgeTypeLabels("FillsOpeningIn", { en: "Fills Opening In", jp: "開口充填" });
    },
  });
})();