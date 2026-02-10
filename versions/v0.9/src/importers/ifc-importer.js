/* ============================================
   ONEXUS — IFC Importer (Full Graph + IFCZIP), web-ifc/WASM
   - Pure browser, zero install, portable.
   - IFC: STEP text (.ifc) and IFCZIP (.ifczip with a .ifc entry)
   - web-ifc version-locked via CDN (JS+WASM): OpenModel(Uint8Array)
   ============================================ */

const WEBIFC_BASE = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.44/';

(function () {
  let apiInstance = null;

  async function ensureIfcApi() {
    if (apiInstance) return apiInstance;

    const mod = await import(WEBIFC_BASE + 'web-ifc-api.js');
    // Merge ALL exports (constants + classes) so type codes exist:
    window.WebIFC = window.WebIFC || {};
    Object.assign(window.WebIFC, mod);     // ← brings in IFCBUILDING, IFCELEMENT, Schemas, etc.
    // (Optional) sanity assert in dev:
    // if (!window.WebIFC.IFCELEMENT) console.warn('web-ifc constants missing!');

    const api = new window.WebIFC.IfcAPI();
    api.SetWasmPath(WEBIFC_BASE); // version-matched
    await api.Init();
    api.SetLogLevel?.(3); // 0=none ... 3=info (optional)
    apiInstance = api;
    return apiInstance;
  }

  // ---------- small utils ----------
  const idSafe = (s) => String(s ?? '').replace(/[^\w\-:.]+/g, '_');
  const asLabel = (s) => String(s ?? '').trim() || '(unnamed)';
  const itGet = (coll, i) => (typeof coll.get === 'function' ? coll.get(i) : coll[i]);
  const itLen = (coll) => (coll ? (typeof coll.size === 'function' ? coll.size() : Array.isArray(coll) ? coll.length : coll.length ?? 0) : 0);
  function* iterIds(coll) { const n = itLen(coll); for (let i = 0; i < n; i++) yield itGet(coll, i); }

  function upsertNode(nodesMap, id, data) {
    const k = idSafe(id);
    if (!nodesMap.has(k)) {
      nodesMap.set(k, {
        data: {
          id: k,
          label: { en: String(id), jp: String(id) },
          displayLabel: String(id),
          nodeType: 'Component',
          category: '',
          level: '',
        },
      });
    }
    const d = nodesMap.get(k).data;
    for (const key of Object.keys(data)) if (data[key] !== undefined && data[key] !== '') d[key] = data[key];
    return nodesMap.get(k);
  }

  function pushEdge(edges, { type, source, target, dimension, directional = true, extra = {} }) {
    if (!source || !target) return;
    const sid = idSafe(source), tid = idSafe(target);
    const id = idSafe(`${type}:${sid}->${tid}:${edges.length + 1}`);
    edges.push({ data: { id, type, source: sid, target: tid, dimension, directional: !!directional, displayType: type, ...extra } });
  }

  function labelOf(api, modelID, expressID) {
    const p = api.GetLine(modelID, expressID);
    return asLabel(p?.Name?.value ?? p?.GlobalId?.value ?? expressID);
  }
  function typeNameOf(api, modelID, expressID) {
    const line = api.GetLine(modelID, expressID);
    const isTypedBy = line?.IsTypedBy;
    if (Array.isArray(isTypedBy) && isTypedBy.length) {
      const rel = api.GetLine(modelID, isTypedBy[0].value);
      if (rel?.RelatingType) {
        const t = api.GetLine(modelID, rel.RelatingType.value);
        return asLabel(t?.Name?.value ?? t?.GlobalId?.value);
      }
    }
    return '';
  }

  // ---------- IFCZIP support (Stored/Deflated) ----------
  const SIG_EOCD = 0x06054b50;   // End of central dir
  const SIG_CEN = 0x02014b50;   // Central dir file header
  const SIG_LOC = 0x04034b50;   // Local file header

  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);

  function findEOCD(u8) {
    // EOCD is within last 64KB; scan backwards for 0x06054b50
    const maxBack = Math.min(u8.byteLength, 0xFFFF + 22);
    const start = u8.byteLength - maxBack;
    const view = dv(u8);
    for (let off = u8.byteLength - 22; off >= start; off--) {
      if (u32(view, off) === SIG_EOCD) return off;
    }
    return -1;
  }

  function parseCentralDirectory(u8) {
    const offEOCD = findEOCD(u8);
    if (offEOCD < 0) throw new Error('ZIP: End of central directory not found.');
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
      const filename = new TextDecoder('utf-8').decode(u8.slice(fnStart, fnEnd));

      entries.push({
        filename,
        gpFlag,
        compMethod,
        compSize,
        uncompSize,
        relOffLH,
      });
      off = fnEnd + extLen + cmtLen;
      if (off > offCD + sizeCD) break;
    }
    return entries;
  }

  function parseLocalHeader(u8, relOffLH) {
    const v = dv(u8);
    if (u32(v, relOffLH) !== SIG_LOC) throw new Error('ZIP: Local header signature not found.');
    const gpFlag = u16(v, relOffLH + 6);
    const method = u16(v, relOffLH + 8);
    const fnLen = u16(v, relOffLH + 26);
    const extLen = u16(v, relOffLH + 28);
    const dataOff = relOffLH + 30 + fnLen + extLen;
    return { gpFlag, method, dataOff };
  }

  async function inflateRawDeflate(compressedU8) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('IFCZIP: Deflate not supported in this browser (DecompressionStream missing). Use Stored entries or a Chromium/Edge runtime.');
    }
    const stream = new Blob([compressedU8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function tryUnzipIFC(u8zip) {
    const entries = parseCentralDirectory(u8zip);
    // pick the first *.ifc (non-directory); if multiple, prefer the largest
    const ifcEntries = entries
      .filter(e => !e.filename.endsWith('/') && e.filename.toLowerCase().endsWith('.ifc'))
      .sort((a, b) => b.uncompSize - a.uncompSize);
    if (!ifcEntries.length) {
      throw new Error('IFCZIP: No .ifc entry found inside archive.');
    }
    const pick = ifcEntries[0];

    if (pick.gpFlag & 0x01) throw new Error('IFCZIP: Encrypted entries are not supported.');
    const loc = parseLocalHeader(u8zip, pick.relOffLH);

    const compSlice = u8zip.subarray(loc.dataOff, loc.dataOff + pick.compSize);
    if (loc.method === 0) {
      // Stored
      return compSlice; // already plain bytes (STEP text)
    } else if (loc.method === 8) {
      // Deflated
      return await inflateRawDeflate(compSlice);
    } else {
      throw new Error('IFCZIP: Unsupported compression method ' + loc.method);
    }
  }

  // ---------- main parse ----------
  // ---------- main parse ----------
  async function parseIFCToOnexusGraph(arrayBuffer, options = {}) {
    const opt = {
      includeProperties: true,
      includePorts: true,
      includeElementConnectivity: true,
      limitPropsPerPset: 8,
      capFallbackElements: 5000, // safety cap when falling back
      ...options,
    };

    const api = await ensureIfcApi();

    // Always coerce to Uint8Array
    let u8;
    if (arrayBuffer instanceof Uint8Array) u8 = arrayBuffer;
    else if (arrayBuffer instanceof ArrayBuffer) u8 = new Uint8Array(arrayBuffer);
    else if (typeof arrayBuffer?.buffer === 'object' && arrayBuffer.byteLength !== undefined) u8 = new Uint8Array(arrayBuffer.buffer);
    else throw new Error('IFC loader: unsupported input type; expected Uint8Array/ArrayBuffer');

    // IFCZIP? -> extract .ifc
    if (u8[0] === 0x50 && u8[1] === 0x4B) {
      u8 = await tryUnzipIFC(u8);
    }

    // ---- Preflight (STEP only) ----
    const size = u8.byteLength;
    if (!size || size < 20) throw new Error('IFC file is empty or too small (size < 20 bytes).');

    let headTxt = '';
    try { headTxt = new TextDecoder('utf-8', { fatal: false }).decode(u8.slice(0, Math.min(256, size))).trimStart(); } catch { }

    if (headTxt.startsWith('{')) {
      throw new Error('IFCJSON detected. Provide STEP (.ifc) or IFCZIP containing a STEP .ifc.');
    }
    if (!headTxt.includes('ISO-10303-21;')) {
      throw new Error('Missing STEP header "ISO-10303-21;". Ensure the .ifc content is plain STEP text.');
    }

    // ---- Open (regular + streaming fallback) ----
    const SETTINGS = {
      COORDINATE_TO_ORIGIN: true,
      CIRCLE_SEGMENTS: 16,
      MEMORY_LIMIT: 1024 * 1024 * 1024,
      TAPE_SIZE: 64 * 1024 * 1024
    }; // web-ifc loader settings. [4](https://autodesk.ifc-manual.com/understanding-ifc/ifc-schema-versions)

    let modelID = 0;
    try { modelID = api.OpenModel(u8, SETTINGS); } catch { }

    if (!modelID) {
      const reader = (offset, length) => u8.subarray(offset, offset + length);
      try { modelID = api.OpenModelFromCallback(reader, SETTINGS); } catch { }
    }

    if (!modelID) {
      const snippet = headTxt.slice(0, 120).replace(/\s+/g, ' ');
      throw new Error('web-ifc OpenModel returned 0 (file may be corrupted/unsupported). Header: "' + snippet + '"');
    }

    // ---------- Constants ----------
    const C = window.WebIFC;
    const {
      IFCBUILDING, IFCBUILDINGSTOREY, IFCSPACE, IFCZONE,
      IFCSYSTEM, IFCDISTRIBUTIONSYSTEM, IFCELEMENT, IFCPRODUCT, IFCDISTRIBUTIONPORT,
      IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES, IFCRELASSIGNSTOGROUP,
      IFCRELDEFINESBYTYPE, IFCRELDEFINESBYPROPERTIES,
      IFCRELVOIDSELEMENT, IFCRELFILLSELEMENT,
      IFCRELCONNECTSELEMENTS, IFCRELCONNECTSPORTS, IFCRELCONNECTSPORTTOELEMENT,
    } = C;

    const nodesMap = new Map();
    const edges = [];

    const idSet = (idsColl) => { const s = new Set(); for (const id of iterIds(idsColl)) s.add(id); return s; };

    // ---------- Diagnostics helper ----------
    const COUNT = (typecode) => {
      try { const ids = api.GetLineIDsWithType(modelID, typecode); return itLen(ids); } catch { return 0; }
    };
    const logCounts = () => {
      const counts = {
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
      };
      console.table(counts);
      return counts;
    };
    const counts0 = logCounts(); // ← will print once per load

    // ---------- Pre-materialize sets used for system/zone grouping ----------
    const systemsSet = idSet(api.GetLineIDsWithType(modelID, IFCSYSTEM));
    const distsysSet = idSet(api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONSYSTEM));
    const zonesSet = idSet(api.GetLineIDsWithType(modelID, IFCZONE));

    // ---------- Spatial nodes ----------
    const addSpatial = (id, nodeType, category) => {
      const name = labelOf(api, modelID, id);
      upsertNode(nodesMap, `IFC_${id}`, { nodeType, category, label: { en: name, jp: name }, displayLabel: name });
    };
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCBUILDING))) addSpatial(id, 'Space', 'Building');
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY))) addSpatial(id, 'Space', 'Storey');
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCSPACE))) addSpatial(id, 'Space', 'Room');
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCZONE))) {
      const name = labelOf(api, modelID, id);
      upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'Space', category: 'Zone', label: { en: name, jp: name }, displayLabel: name });
    }

    // ---------- System nodes ----------
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCSYSTEM))) {
      const name = labelOf(api, modelID, id);
      upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'System', category: 'BuildingSystem', label: { en: name, jp: name }, displayLabel: name });
    }
    for (const id of iterIds(api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONSYSTEM))) {
      const name = labelOf(api, modelID, id);
      upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'System', category: 'BuildingSystem', label: { en: name, jp: name }, displayLabel: name });
    }

    // ---------- RelContainedInSpatialStructure -> LocatedIn ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE))) {
      const rel = api.GetLine(modelID, rid);
      const sId = rel?.RelatingStructure?.value;
      if (!sId) continue;

      const sNode = `IFC_${sId}`;
      const sLbl = labelOf(api, modelID, sId);
      upsertNode(nodesMap, sNode, { nodeType: 'Space', category: 'Spatial', label: { en: sLbl, jp: sLbl }, displayLabel: sLbl });

      const related = rel?.RelatedElements ?? [];
      for (const r of related) {
        const eid = r.value;
        const name = labelOf(api, modelID, eid);
        upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: name, jp: name }, displayLabel: name });
        pushEdge(edges, { type: 'LocatedIn', source: `IFC_${eid}`, target: sNode, dimension: 'Spatial', directional: true });
      }
    }

    // ---------- Aggregates -> PartOfSystem ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELAGGREGATES))) {
      const rel = api.GetLine(modelID, rid);
      const parent = rel?.RelatingObject?.value;
      const children = rel?.RelatedObjects ?? [];
      if (!parent || !children.length) continue;

      const pName = labelOf(api, modelID, parent);
      upsertNode(nodesMap, `IFC_${parent}`, { nodeType: 'Component', category: 'Assembly', label: { en: pName, jp: pName }, displayLabel: pName });

      for (const c of children) {
        const cid = c.value;
        const cName = labelOf(api, modelID, cid);
        upsertNode(nodesMap, `IFC_${cid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: cName, jp: cName }, displayLabel: cName });
        pushEdge(edges, { type: 'PartOfSystem', source: `IFC_${parent}`, target: `IFC_${cid}`, dimension: 'System', directional: true });
      }
    }

    // ---------- AssignsToGroup -> Systems / Zones ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELASSIGNSTOGROUP))) {
      const rel = api.GetLine(modelID, rid);
      const groupId = rel?.RelatingGroup?.value;
      const objs = rel?.RelatedObjects ?? [];
      if (!groupId || !objs.length) continue;

      const isSystem = systemsSet.has(groupId) || distsysSet.has(groupId);
      const isZone = zonesSet.has(groupId);
      if (!isSystem && !isZone) continue;

      const gName = labelOf(api, modelID, groupId);
      upsertNode(nodesMap, `IFC_${groupId}`, {
        nodeType: isZone ? 'Space' : 'System',
        category: isZone ? 'Zone' : 'BuildingSystem',
        label: { en: gName, jp: gName },
        displayLabel: gName,
      });

      for (const o of objs) {
        const eid = o.value;
        const eName = labelOf(api, modelID, eid);
        upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: eName, jp: eName }, displayLabel: eName });

        if (isSystem) {
          pushEdge(edges, { type: 'PartOfSystem', source: `IFC_${eid}`, target: `IFC_${groupId}`, dimension: 'System', directional: false });
        } else {
          pushEdge(edges, { type: 'InZone', source: `IFC_${eid}`, target: `IFC_${groupId}`, dimension: 'Spatial', directional: false });
        }
      }
    }

    // ---------- DefinesByType -> OfType ----------
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE))) {
      const rel = api.GetLine(modelID, rid);
      const tId = rel?.RelatingType?.value;
      const objs = rel?.RelatedObjects ?? [];
      if (!tId || !objs.length) continue;

      const tName = labelOf(api, modelID, tId);
      upsertNode(nodesMap, `IFC_${tId}`, { nodeType: 'ComponentType', category: 'Type', label: { en: tName, jp: tName }, displayLabel: tName });

      for (const o of objs) {
        const eid = o.value;
        const eName = labelOf(api, modelID, eid);
        upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: eName, jp: eName }, displayLabel: eName });
        pushEdge(edges, { type: 'OfType', source: `IFC_${eid}`, target: `IFC_${tId}`, dimension: 'System', directional: false });
      }
    }

    // ---------- DefinesByProperties -> HasProperties ----------
    if (opt.includeProperties) {
      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES))) {
        const rel = api.GetLine(modelID, rid);
        const pRef = rel?.RelatingPropertyDefinition;
        const objs = rel?.RelatedObjects ?? [];
        if (!pRef || !objs.length) continue;

        const psetId = pRef.value;
        const pset = api.GetLine(modelID, psetId);
        const psetName = asLabel(pset?.Name?.value ?? `PSet_${psetId}`);

        let summary = psetName;
        try {
          const props = pset?.HasProperties ?? [];
          const pairs = [];
          for (let i = 0; i < Math.min(props.length, opt.limitPropsPerPset); i++) {
            const pid = props[i]?.value;
            const prop = pid ? api.GetLine(modelID, pid) : null;
            const pname = asLabel(prop?.Name?.value);
            const pval = prop?.NominalValue?.value ?? prop?.NominalValue?._text ?? '';
            if (pname) pairs.push(`${pname}${pval ? `=${pval}` : ''}`);
          }
          if (pairs.length) summary = `${psetName}: ${pairs.join(', ')}`;
        } catch { }

        upsertNode(nodesMap, `IFC_${psetId}`, { nodeType: 'PropertySet', category: 'PropertySet', label: { en: summary, jp: summary }, displayLabel: summary });

        for (const o of objs) {
          const eid = o.value;
          const eName = labelOf(api, modelID, eid);
          upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: eName, jp: eName }, displayLabel: eName });
          pushEdge(edges, { type: 'HasProperties', source: `IFC_${eid}`, target: `IFC_${psetId}`, dimension: 'System', directional: false });
        }
      }
    }

    // ---------- Openings ----------
    const openingToHost = new Map();
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT))) {
      const v = api.GetLine(modelID, rid);
      const opening = v?.RelatedOpeningElement?.value;
      const host = v?.RelatingBuildingElement?.value;
      if (opening && host) openingToHost.set(opening, host);
    }
    for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT))) {
      const rel = api.GetLine(modelID, rid);
      const opening = rel?.RelatingOpeningElement?.value;
      const filler = rel?.RelatedBuildingElement?.value;
      if (!opening || !filler) continue;

      const fName = labelOf(api, modelID, filler);
      upsertNode(nodesMap, `IFC_${filler}`, { nodeType: 'Component', category: 'DoorLike', label: { en: fName, jp: fName }, displayLabel: fName });

      const host = openingToHost.get(opening);
      if (host) {
        const wName = labelOf(api, modelID, host);
        upsertNode(nodesMap, `IFC_${host}`, { nodeType: 'Component', category: 'Wall', label: { en: wName, jp: wName }, displayLabel: wName });
        pushEdge(edges, { type: 'FillsOpeningIn', source: `IFC_${filler}`, target: `IFC_${host}`, dimension: 'System', directional: true });
      }
    }

    // ---------- ConnectsElements ----------
    if (opt.includeElementConnectivity) {
      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSELEMENTS))) {
        const rel = api.GetLine(modelID, rid);
        const a = rel?.RelatingElement?.value;
        const b = rel?.RelatedElement?.value;
        if (!a || !b) continue;

        const aName = labelOf(api, modelID, a);
        const bName = labelOf(api, modelID, b);
        upsertNode(nodesMap, `IFC_${a}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: aName, jp: aName }, displayLabel: aName });
        upsertNode(nodesMap, `IFC_${b}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: bName, jp: bName }, displayLabel: bName });
        pushEdge(edges, { type: 'ConnectsTo', source: `IFC_${a}`, target: `IFC_${b}`, dimension: 'System', directional: false });
      }
    }

    // ---------- Ports ----------
    if (opt.includePorts) {
      const IFCDISTRIBUTIONPORT_IDS = api.GetLineIDsWithType(modelID, IFCDISTRIBUTIONPORT);
      for (const pid of iterIds(IFCDISTRIBUTIONPORT_IDS)) {
        const name = labelOf(api, modelID, pid);
        upsertNode(nodesMap, `IFC_${pid}`, { nodeType: 'Port', category: 'Port', label: { en: name, jp: name }, displayLabel: name });
      }

      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSPORTS))) {
        const rel = api.GetLine(modelID, rid);
        const a = rel?.RelatingPort?.value;
        const b = rel?.RelatedPort?.value;
        if (!a || !b) continue;

        const aName = labelOf(api, modelID, a);
        const bName = labelOf(api, modelID, b);
        upsertNode(nodesMap, `IFC_${a}`, { nodeType: 'Port', category: 'Port', label: { en: aName, jp: aName }, displayLabel: aName });
        upsertNode(nodesMap, `IFC_${b}`, { nodeType: 'Port', category: 'Port', label: { en: bName, jp: bName }, displayLabel: bName });
        pushEdge(edges, { type: 'ConnectsTo', source: `IFC_${a}`, target: `IFC_${b}`, dimension: 'System', directional: false });
      }

      for (const rid of iterIds(api.GetLineIDsWithType(modelID, IFCRELCONNECTSPORTTOELEMENT))) {
        const rel = api.GetLine(modelID, rid);
        const port = rel?.RelatingPort?.value;
        const elem = rel?.RelatedElement?.value;
        if (!port || !elem) continue;

        const pName = labelOf(api, modelID, port);
        const eName = labelOf(api, modelID, elem);
        upsertNode(nodesMap, `IFC_${port}`, { nodeType: 'Port', category: 'Port', label: { en: pName, jp: pName }, displayLabel: pName });
        upsertNode(nodesMap, `IFC_${elem}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: eName, jp: eName }, displayLabel: eName });
        pushEdge(edges, { type: 'PortOf', source: `IFC_${port}`, target: `IFC_${elem}`, dimension: 'System', directional: true });
      }
    }

    // ---------- Opportunistic typing for elements ----------
    const opportunisticElementTyping = () => {
      const eleIds = api.GetLineIDsWithType(modelID, IFCELEMENT);
      for (const eid of iterIds(eleIds)) {
        const en = labelOf(api, modelID, eid);
        upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en, jp: en }, displayLabel: en });

        const tName = typeNameOf(api, modelID, eid);
        if (tName) {
          upsertNode(nodesMap, `TYPE_${tName}`, { nodeType: 'ComponentType', category: 'Type', label: { en: tName, jp: tName }, displayLabel: tName });
          pushEdge(edges, { type: 'OfType', source: `IFC_${eid}`, target: `TYPE_${tName}`, dimension: 'System', directional: false, extra: { confidence: 'Inferred' } });
        }
      }
    };
    opportunisticElementTyping();

    // ---------- FALLBACK A: If still nothing, build from IFCELEMENT / IFCPRODUCT ----------
    if (nodesMap.size === 0) {
      console.warn('[ONEXUS/IFC] Fallback A: enumerating IFCELEMENT/IFCPRODUCT (no relations).');
      let list = api.GetLineIDsWithType(modelID, IFCELEMENT);
      if (!itLen(list)) list = api.GetLineIDsWithType(modelID, IFCPRODUCT);
      let count = 0;
      for (const id of iterIds(list)) {
        const name = labelOf(api, modelID, id);
        upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: name, jp: name }, displayLabel: name });
        count++; if (count >= opt.capFallbackElements) break;
      }
    }

    // ---------- FALLBACK B: Enumerate by types and filter by IsIfcElement ----------
    if (nodesMap.size === 0) {
      try {
        console.warn('[ONEXUS/IFC] Fallback B: GetAllTypesOfModel() & IsIfcElement().');
        const types = api.GetAllTypesOfModel(modelID); // returns numeric type codes (schema-specific) [1](https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/)
        let count = 0;
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          if (typeof api.IsIfcElement === 'function' && !api.IsIfcElement(t)) continue; // [1](https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/)
          const ids = api.GetLineIDsWithType(modelID, t);
          for (const id of iterIds(ids)) {
            const name = labelOf(api, modelID, id);
            upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: name, jp: name }, displayLabel: name });
            count++; if (count >= opt.capFallbackElements) break;
          }
          if (count >= opt.capFallbackElements) break;
        }
      } catch (e) {
        console.warn('[ONEXUS/IFC] Fallback B failed:', e);
      }
    }

    // ---------- finalize ----------
    const nodes = Array.from(nodesMap.values());
    console.info(`[ONEXUS/IFC] Built nodes=${nodes.length}, edges=${edges.length}.`);
    api.CloseModel(modelID);
    return { elements: { nodes, edges } };
  }


  // ---------- UI glue ----------
  async function loadIFC(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;
    const file = files.find((f) => f.name.toLowerCase().endsWith('.ifc') || f.name.toLowerCase().endsWith('.ifczip'));
    if (!file) return;

    const buf = await file.arrayBuffer();
    const graph = await parseIFCToOnexusGraph(buf);
    injectGraph(graph);
  }

  function injectGraph(graph) {
    if (typeof window.onexusLoadGraph === 'function') {
      window.onexusLoadGraph(graph);
    } else if (window.cy) {
      const cy = window.cy;
      cy.elements().remove();
      cy.add(graph.elements.nodes);
      cy.add(graph.elements.edges);
      window.setLanguage?.('en');
      window.buildCategoryFilter?.();
      window.applyLayout?.('default');
      cy.fit(undefined, 50);
    }
  }

  // expose
  window.ONEXUS_IFC = { parseIFCToOnexusGraph, loadIFC };
})();