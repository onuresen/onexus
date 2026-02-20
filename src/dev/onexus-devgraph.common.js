/* =========================================================
ONEXUS – DevGraph Common (shared builders + merge)
- Produces ONEXUS JSON that passes validateOnexusJson():
  elements.nodes[].data: { id, nodeType, category, label{en,jp}, displayLabel }
  elements.edges[].data: { id, type, dimension, source, target, directional(boolean) }
- Safe: no mutation of window.cy
Exports (back-compat):
  window.ONEXUS_DEVGRAPH = {
    idSafe, makeGraph, addNode, addEdge,
    ensureGraph, dedupeGraph, mergeGraphs, downloadGraph
  }
========================================================= */
(function () {
    const NS = (window.ONEXUS_DEVGRAPH = window.ONEXUS_DEVGRAPH || {});
    const NOW = () => new Date().toISOString();

    // keep the same idSafe signature your modules already use
    const idSafe = (s) => String(s ?? "").replace(/[^\w\-:.]+/g, "_");

    function ensureLabel(label, fallback) {
        if (label && typeof label === "object") {
            const en = String(label.en ?? fallback ?? "").trim() || String(fallback ?? "(unnamed)");
            const jp = String(label.jp ?? en).trim() || en;
            return { en, jp };
        }
        const base = String(label ?? fallback ?? "").trim() || String(fallback ?? "(unnamed)");
        return { en: base, jp: base };
    }

    function normalizeNodeWrap(n) {
        const w = n?.data ? n : { data: n || {} };
        const d0 = w.data || {};
        const id = String(d0.id ?? "").trim();
        if (!id) return null;

        const nodeType = String(d0.nodeType ?? "Component").trim() || "Component";
        const category = String(d0.category ?? d0.revitCategory ?? "Uncategorized").trim() || "Uncategorized";
        const label = ensureLabel(d0.label, d0.displayLabel ?? id);
        const displayLabel = String(d0.displayLabel ?? label.en ?? id);

        return {
            data: {
                ...d0,
                id,
                nodeType,
                category,
                label,
                displayLabel,
            },
            classes: w.classes || "",
        };
    }

    function normalizeEdgeWrap(e) {
        const w = e?.data ? e : { data: e || {} };
        const d0 = w.data || {};

        const type = String(d0.type ?? "RelatedTo").trim() || "RelatedTo";
        const dimension = String(d0.dimension ?? "System").trim() || "System";
        const source = String(d0.source ?? "").trim();
        const target = String(d0.target ?? "").trim();

        // directional MUST be boolean
        const directional = (typeof d0.directional === "boolean") ? d0.directional : !!d0.directional;

        if (!source || !target) return null;

        let id = String(d0.id ?? "").trim();
        if (!id) {
            // stable-ish fallback id; uniqueness handled in dedupeGraph()
            id = `E_${idSafe(type)}_${idSafe(source)}_${idSafe(target)}_${directional ? 1 : 0}`;
        }

        return {
            data: {
                ...d0,
                id,
                type,
                dimension,
                source,
                target,
                directional,
            },
            classes: w.classes || "",
        };
    }

    // Creates a new ONEXUS graph shell
    function makeGraph(meta = {}) {
        return {
            meta: {
                schema: "onexus",
                dev: true,
                exportedAt: NOW(),
                ...meta,
            },
            elements: { nodes: [], edges: [] },
        };
    }

    // Adds/merges node (last-write-wins by id when deduped)
    function addNode(graph, { id, nodeType, category, label, data = {}, classes = "" }) {
        if (!graph?.elements?.nodes) throw new Error("addNode: invalid graph");
        const nid = String(id ?? "").trim();
        if (!nid) throw new Error("addNode: id required");

        const lbl = ensureLabel(label, nid);
        const node = {
            data: {
                id: nid,
                nodeType: String(nodeType ?? data.nodeType ?? "Component"),
                category: String(category ?? data.category ?? data.revitCategory ?? "Uncategorized") || "Uncategorized",
                label: (typeof label === "object") ? ensureLabel(label, nid) : lbl,
                displayLabel: (typeof label === "object") ? (label.en ?? nid) : String(label ?? nid),
                ...data,
            },
            classes: classes || "",
        };
        graph.elements.nodes.push(node);
        return node;
    }

    // Adds edge (directional boolean guaranteed)
    function addEdge(graph, { id, type, dimension, source, target, directional = true, data = {}, classes = "" }) {
        if (!graph?.elements?.edges) throw new Error("addEdge: invalid graph");
        const sid = String(source ?? "").trim();
        const tid = String(target ?? "").trim();
        if (!sid || !tid) throw new Error("addEdge: source/target required");

        const eid =
            String(id ?? "").trim() ||
            `E_${idSafe(type ?? "RelatedTo")}_${idSafe(sid)}_${idSafe(tid)}_${Math.random().toString(36).slice(2, 8)}`;

        const edge = {
            data: {
                id: eid,
                type: String(type ?? "RelatedTo"),
                dimension: String(dimension ?? "System"),
                source: sid,
                target: tid,
                directional: !!directional, // MUST be boolean
                ...data,
            },
            classes: classes || "",
        };
        graph.elements.edges.push(edge);
        return edge;
    }

    // Ensures a graph is ONEXUS-compliant (fills missing required fields)
    function ensureGraph(inputGraph, opts = {}) {
        const g0 = inputGraph || {};
        const out = makeGraph({ ...(g0.meta || {}), ...(opts.meta || {}) });

        const nodes = Array.isArray(g0.elements?.nodes) ? g0.elements.nodes : [];
        const edges = Array.isArray(g0.elements?.edges) ? g0.elements.edges : [];

        // normalize nodes
        for (const n of nodes) {
            const nn = normalizeNodeWrap(n);
            if (nn) out.elements.nodes.push(nn);
        }

        // normalize edges
        for (const e of edges) {
            const ee = normalizeEdgeWrap(e);
            if (ee) out.elements.edges.push(ee);
        }

        return dedupeGraph(out, opts);
    }

    // Dedupes nodes by id and edges by (type,dimension,source,target,directional)
    function dedupeGraph(graph, opts = {}) {
        const autoCreateEndpoints = opts.autoCreateEndpointNodes !== false;

        const nodes = graph?.elements?.nodes ?? [];
        const edges = graph?.elements?.edges ?? [];

        const nMap = new Map();
        for (const n of nodes) {
            const nn = normalizeNodeWrap(n);
            if (!nn) continue;
            const id = nn.data.id;
            const prev = nMap.get(id);
            // last-write-wins merge
            nMap.set(id, prev ? { data: { ...prev.data, ...nn.data }, classes: (prev.classes || nn.classes || "") } : nn);
        }

        const eKey = (d) =>
            `${String(d.type)}\n${String(d.dimension)}\n${String(d.source)}\n${String(d.target)}\n${d.directional ? 1 : 0}`;

        const eMap = new Map();
        for (const e of edges) {
            const ee = normalizeEdgeWrap(e);
            if (!ee) continue;

            // ensure endpoints exist (optional)
            if (autoCreateEndpoints) {
                if (!nMap.has(ee.data.source)) {
                    nMap.set(ee.data.source, normalizeNodeWrap({ data: { id: ee.data.source, nodeType: "Component", category: "Dev" } }));
                }
                if (!nMap.has(ee.data.target)) {
                    nMap.set(ee.data.target, normalizeNodeWrap({ data: { id: ee.data.target, nodeType: "Component", category: "Dev" } }));
                }
            }

            const k = eKey(ee.data);
            const prev = eMap.get(k);
            eMap.set(k, prev ? { data: { ...prev.data, ...ee.data }, classes: (prev.classes || ee.classes || "") } : ee);
        }

        // ensure unique edge ids
        const used = new Set();
        const outEdges = [];
        let seq = 0;
        for (const e of eMap.values()) {
            const d = { ...e.data };
            if (!d.id || used.has(d.id)) d.id = `E_${++seq}`;
            used.add(d.id);
            outEdges.push({ data: d, classes: e.classes || "" });
        }

        graph.elements.nodes = Array.from(nMap.values()).map((n) => ({ data: { ...n.data }, classes: n.classes || "" }));
        graph.elements.edges = outEdges.map((e) => ({ data: { ...e.data }, classes: e.classes || "" }));
        return graph;
    }

    // Merges two ONEXUS graphs, then dedupes (schema-safe)
    function mergeGraphs(graphA, graphB, metaMerge = {}, opts = {}) {
        const A = ensureGraph(graphA, opts);
        const B = ensureGraph(graphB, opts);
        const out = makeGraph({
            ...(A.meta || {}),
            ...(B.meta || {}),
            ...metaMerge,
            mergedFrom: Array.from(new Set([A.meta?.kind, B.meta?.kind].filter(Boolean))),
        });
        out.elements.nodes.push(...(A.elements.nodes || []), ...(B.elements.nodes || []));
        out.elements.edges.push(...(A.elements.edges || []), ...(B.elements.edges || []));
        return dedupeGraph(out, opts);
    }

    // Unified download
    function downloadGraph(graph, filename = "onexus-devgraph.json") {
        const g = ensureGraph(graph);
        const blob = new Blob([JSON.stringify(g, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 800);
    }

    // exports
    NS.idSafe = idSafe;
    NS.makeGraph = makeGraph;
    NS.addNode = addNode;
    NS.addEdge = addEdge;
    NS.ensureGraph = ensureGraph;
    NS.dedupeGraph = dedupeGraph;
    NS.mergeGraphs = mergeGraphs;
    NS.downloadGraph = downloadGraph;
})();