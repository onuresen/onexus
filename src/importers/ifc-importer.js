/* ===============================
   ONEXUS — IFC Importer (web-ifc/WASM)
   - Open .ifc in-browser using Uint8Array
   - Use WebIFC constants (no hard-coded numbers)
   - Build ONEXUS nodes/edges:
     * LocatedIn  (IfcRelContainedInSpatialStructure)  [Spatial]
     * PartOfSystem (IfcRelAggregates)                 [System]
     * FillsOpeningIn (IfcRelFillsElement→IfcRelVoidsElement) [System]
   References: web-ifc API/Init/OpenModel usage; IFC relationship semantics.
   =============================== */

const WEBIFC_BASE = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/'; // one source of truth

(function () {
  let apiInstance = null;

  async function ensureIfcApi() {
    if (apiInstance) return apiInstance;

    // Load the exact JS that matches the WASM
    const mod = await import(WEBIFC_BASE + 'web-ifc-api.js');
    window.WebIFC = window.WebIFC || {};
    window.WebIFC.IfcAPI = mod.IfcAPI;

    const api = new window.WebIFC.IfcAPI();
    api.SetWasmPath(WEBIFC_BASE);  // <-- version-matched wasm path
    await api.Init();              // required before OpenModel

    apiInstance = api;
    return apiInstance;
  }

  // --- small utils ---
  const idSafe = (s) => String(s || '').replace(/[^\w\-:.]+/g, '_');
  const asLabel = (s) => (String(s || '').trim() || '(unnamed)');

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
          level: ''
        }
      });
    }
    const d = nodesMap.get(k).data;
    for (const key of Object.keys(data)) {
      if (data[key] !== undefined && data[key] !== '') d[key] = data[key];
    }
    return nodesMap.get(k);
  }

  function pushEdge(edges, { type, source, target, dimension, directional = true, extra = {} }) {
    if (!source || !target) return;
    const sid = idSafe(source), tid = idSafe(target);
    const id = idSafe(`${type}:${sid}->${tid}`);
    edges.push({ data: { id, type, source: sid, target: tid, dimension, directional, displayType: type, ...extra } });
  }

  function labelOf(api, modelID, expressID) {
    const p = api.GetLine(modelID, expressID);
    return asLabel(p?.Name?.value || p?.GlobalId?.value || expressID);
  }

  function typeNameOf(api, modelID, expressID) {
    const line = api.GetLine(modelID, expressID);
    const isTypedBy = line?.IsTypedBy;
    if (Array.isArray(isTypedBy) && isTypedBy.length) {
      const rel = api.GetLine(modelID, isTypedBy[0].value);
      if (rel?.RelatingType) {
        const t = api.GetLine(modelID, rel.RelatingType.value);
        return asLabel(t?.Name?.value || t?.GlobalId?.value);
      }
    }
    return '';
  }

  // Count helper for web-ifc id sets
  const countOf = (coll) => {
    try {
      if (!coll) return 0;
      if (typeof coll.size === 'function') return coll.size();
      if (Array.isArray(coll)) return coll.length;
      if (typeof coll.length === 'number') return coll.length;
    } catch { }
    return 0;
  };

  // --- IFC -> ONEXUS ---
  async function parseIFCToOnexusGraph(arrayBuffer) {
    const api = await ensureIfcApi();

    const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    console.log('ASCII head:', new TextDecoder().decode(u8.slice(0, 20)));
    console.log('HEX head:', Array.from(u8.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('IFC size (bytes):', u8.byteLength);

    const modelID = api.OpenModel(u8);
    if (!modelID) throw new Error('OpenModel(u8) returned 0');

    // --- 2) fallback: try string (some files parse only as text)
    if (!modelID) {
      try {
        const txt = new TextDecoder().decode(u8);
        modelID = api.OpenModel(txt);
        console.log('Fallback OpenModel(string) ->', modelID);
      } catch (e) {
        console.warn('OpenModel(string) threw:', e);
      }
    }

    if (!modelID) {
      throw new Error('web-ifc OpenModel returned 0 after both Uint8Array and string paths.');
    }

    // === from here, unchanged mapping logic (constants from WebIFC) ===
    const C = window.WebIFC;
    const {
      IFCSPACE, IFCBUILDINGSTOREY, IFCBUILDING, IFCPRODUCT,
      IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES, IFCRELFILLSELEMENT, IFCRELVOIDSELEMENT
    } = C;

    const nodesMap = new Map();
    const edges = [];
    const countOf = (c) => (c?.size?.() ?? c?.length ?? 0);

    const spaces = api.GetLineIDsWithType(modelID, IFCSPACE);
    const storeys = api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
    const buildings = api.GetLineIDsWithType(modelID, IFCBUILDING);
    const products = api.GetLineIDsWithType(modelID, IFCPRODUCT);

    const addSpatial = (id, category) => {
      const name = labelOf(api, modelID, id);
      upsertNode(nodesMap, `IFC_${id}`, { nodeType: 'Space', category, label: { en: name, jp: name }, displayLabel: name });
    };
    for (let i = 0; i < countOf(spaces); i++)   addSpatial(spaces.get ? spaces.get(i) : spaces[i], 'Room');
    for (let i = 0; i < countOf(storeys); i++)  addSpatial(storeys.get ? storeys.get(i) : storeys[i], 'Storey');
    for (let i = 0; i < countOf(buildings); i++)addSpatial(buildings.get ? buildings.get(i) : buildings[i], 'Building');

    // RelContainedInSpatialStructure → LocatedIn
    const relContained = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < countOf(relContained); i++) {
      const rid = relContained.get ? relContained.get(i) : relContained[i];
      const rel = api.GetLine(modelID, rid);
      const sId = rel?.RelatingStructure?.value;
      if (!sId) continue;

      const sNode = `IFC_${sId}`;
      const sLbl = labelOf(api, modelID, sId);
      upsertNode(nodesMap, sNode, { nodeType: 'Space', category: 'Spatial', label: { en: sLbl, jp: sLbl }, displayLabel: sLbl });

      const related = rel?.RelatedElements || [];
      for (const r of related) {
        const eid = r.value;
        const name = labelOf(api, modelID, eid);
        upsertNode(nodesMap, `IFC_${eid}`, { nodeType: 'Component', category: 'BuiltElement', label: { en: name, jp: name }, displayLabel: name });

        const tName = typeNameOf(api, modelID, eid);
        if (tName) {
          upsertNode(nodesMap, `TYPE_${tName}`, { nodeType: 'ComponentType', category: 'Type', label: { en: tName, jp: tName }, displayLabel: tName });
          pushEdge(edges, { type: 'PartOfSystem', source: `IFC_${eid}`, target: `TYPE_${tName}`, dimension: 'System', directional: false, extra: { confidence: 'Inferred' } });
        }
        pushEdge(edges, { type: 'LocatedIn', source: `IFC_${eid}`, target: sNode, dimension: 'Spatial' });
      }
    }

    // RelAggregates → PartOfSystem
    const relAggr = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
    for (let i = 0; i < countOf(relAggr); i++) {
      const rid = relAggr.get ? relAggr.get(i) : relAggr[i];
      const rel = api.GetLine(modelID, rid);
      const parent = rel?.RelatingObject?.value;
      const children = rel?.RelatedObjects || [];
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

    // RelFillsElement + RelVoidsElement → FillsOpeningIn (door/window -> wall)
    const relFills = api.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT);
    const relVoids = api.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT);
    const openingToHost = new Map();
    for (let i = 0; i < countOf(relVoids); i++) {
      const vid = relVoids.get ? relVoids.get(i) : relVoids[i];
      const v = api.GetLine(modelID, vid);
      const opening = v?.RelatedOpeningElement?.value;
      const host = v?.RelatingBuildingElement?.value;
      if (opening && host) openingToHost.set(opening, host);
    }
    for (let i = 0; i < countOf(relFills); i++) {
      const rid = relFills.get ? relFills.get(i) : relFills[i];
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

    const nodes = Array.from(nodesMap.values());
    api.CloseModel(modelID);
    return { elements: { nodes, edges } };
  }

  async function loadIFC(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;
    const file = files.find(f => f.name.toLowerCase().endsWith('.ifc'));
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

  window.ONEXUS_IFC = { parseIFCToOnexusGraph, loadIFC };
})();