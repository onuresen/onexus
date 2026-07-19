/* =========================================================
 ONEXUS – Import Normalizer & Metadata Stamping
 - Canonicalizes importer outputs into ONEXUS schema
 - Stamps meta.importer/sourceFiles/importedAt/importSession
 - Preserves graph.view (e.g., view.arcOrder) into meta.view
 - NEW (Set C): ONEXUS.import.applyMeta(graph, opts) as single meta entry point
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    ONX.util = ONX.util || {};
    const U = ONX.util;

    const clone = U.clone || function (x) {
        return (typeof structuredClone === "function")
            ? structuredClone(x)
            : JSON.parse(JSON.stringify(x));
    };

    const idSafe = U.idSafe || function (s) {
        return String(s ?? "").replace(/[^\w\-:.]+/g, "_");
    };

    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const nowIso = () => new Date().toISOString();
    const asStr = (x, fallback = "") => {
        const s = String(x ?? "").trim();
        return s ? s : fallback;
    };

    function ensureLabelObject(label, fallback) {
        if (label && typeof label === "object") {
            const en = asStr(label.en, asStr(fallback, ""));
            const jp = asStr(label.jp, en);
            return { en, jp };
        }
        const en = asStr(label, asStr(fallback, ""));
        return { en, jp: en };
    }

    function normalizeCategory(d) {
        const cat = asStr(d.category, "");
        const rev = asStr(d.revitCategory, "");
        return cat || rev || "Uncategorized";
    }

    function normalizeNodeWrap(nw) {
        const d0 = (nw && nw.data) ? nw.data : (nw || {});
        const id = asStr(d0.id, "");
        if (!id) return null;

        const nodeType = asStr(d0.nodeType, "Component");
        const category = normalizeCategory(d0);
        const label = ensureLabelObject(d0.label, d0.displayLabel ?? id);

        const lang = window.__onexus_state?.language ?? window.___onexus_state?.language ?? "en";
        const displayLabel = asStr(d0.displayLabel, label[lang] ?? label.en ?? id);

        const data = { ...d0, id, nodeType, category, label, displayLabel };
        return { data, classes: nw?.classes ?? "" };
    }

    function normalizePhase(ph) {
        if (ph == null) return [];
        if (Array.isArray(ph)) return ph.map(x => asStr(x, "")).filter(Boolean);
        const s = asStr(ph, "");
        if (!s) return [];
        return s.split(/\n/g).map(x => asStr(x, "")).filter(Boolean);
    }

    const TRUTH_CLASSES = new Set(["source-native", "governed", "project-defined", "inferred", "decision-created", "historical"]);

    function normalizeRelationship(d0) {
        const incoming = isObj(d0.relationship) ? d0.relationship : {};
        const legacyTruth = asStr(d0.truthClass, "");
        const inferred = asStr(d0.confidence, "").toLowerCase() === "inferred";
        const candidateTruth = asStr(incoming.truthClass, legacyTruth || (inferred ? "inferred" : "source-native")).toLowerCase();
        const truthClass = TRUTH_CLASSES.has(candidateTruth) ? candidateTruth : "source-native";

        const source0 = isObj(incoming.source) ? incoming.source : {};
        const provenance0 = isObj(incoming.provenance) ? incoming.provenance : {};
        const validity0 = isObj(incoming.validity) ? incoming.validity : {};
        const review0 = isObj(incoming.review) ? incoming.review : {};
        const lifecycle0 = isObj(incoming.lifecycle) ? incoming.lifecycle : {};
        const legacyEvidence = Array.isArray(d0.evidenceIds) ? d0.evidenceIds.map(String) : [];

        return {
            ...incoming,
            contract: "onexus.relationship.v1",
            truthClass,
            source: {
                ...source0,
                system: asStr(source0.system, asStr(d0.sourceSystem, "unknown")),
                recordId: asStr(source0.recordId, asStr(d0.externalId, "")),
                url: asStr(source0.url, asStr(d0.externalUrl, "")),
            },
            provenance: {
                ...provenance0,
                method: asStr(provenance0.method, inferred ? "inference" : "import"),
                evidenceIds: Array.isArray(provenance0.evidenceIds) ? provenance0.evidenceIds.map(String) : legacyEvidence,
                observedAt: asStr(provenance0.observedAt, asStr(d0.createdAt, "")),
            },
            confidence: incoming.confidence ?? d0.confidence ?? "Explicit",
            validity: {
                ...validity0,
                from: asStr(validity0.from, ""),
                to: asStr(validity0.to, ""),
                status: asStr(validity0.status, truthClass === "historical" ? "historical" : "active"),
            },
            review: {
                ...review0,
                status: asStr(review0.status, truthClass === "inferred" ? "proposed" : "unreviewed"),
                reviewedBy: asStr(review0.reviewedBy, ""),
                reviewedAt: asStr(review0.reviewedAt, ""),
            },
            lifecycle: {
                ...lifecycle0,
                deleted: lifecycle0.deleted === true || d0.deletedReference === true,
                deletedAt: asStr(lifecycle0.deletedAt, ""),
            },
        };
    }

    function normalizeEdgeWrap(ew) {
        const d0 = (ew && ew.data) ? ew.data : (ew || {});
        const source = asStr(d0.source, "");
        const target = asStr(d0.target, "");
        if (!source || !target) return null;

        const type = asStr(d0.type, "RelatedTo");
        const dimension = asStr(d0.dimension, "System");
        const directional = (typeof d0.directional === "boolean") ? d0.directional : !!d0.directional;
        const phase = normalizePhase(d0.phase);
        const owner = asStr(d0.owner, "");
        const risk = asStr(d0.risk, "");
        const confidence = asStr(d0.confidence, "");
        const notes = (d0.notes == null) ? "" : String(d0.notes);

        const labelsMap =
            window.__onexus_labels?.[window.__onexus_state?.language ?? "en"] ??
            window.__onexus_labels?.en ??
            {};

        const displayType = asStr(d0.displayType, labelsMap[type] ?? type);
        const relationship = normalizeRelationship(d0);

        const data = {
            ...d0,
            id: asStr(d0.id, ""),
            type,
            dimension,
            source,
            target,
            directional,
            phase,
            owner,
            risk,
            confidence,
            notes,
            displayType,
            relationship,
            truthClass: relationship.truthClass,
        };

        return { data, classes: ew?.classes ?? "" };
    }

    function edgeKey(d) {
        return `${d.type}\n${d.dimension}\n${d.source}\n${d.target}\n${d.directional ? 1 : 0}`;
    }

    function ensureUniqueEdgeIds(edges) {
        const used = new Set();
        let seq = 0;
        for (const e of edges) {
            let id = asStr(e.data.id, "");
            if (!id || used.has(id)) {
                id = `E_${++seq}`;
                while (used.has(id)) id = `E_${++seq}`;
                e.data.id = id;
            }
            used.add(id);
        }
    }

    function dedupeEdges(edges) {
        const map = new Map();
        for (const e of edges) {
            const k = edgeKey(e.data);
            const prev = map.get(k);
            if (!prev) map.set(k, e);
            else {
                const pid = asStr(prev.data.id, "");
                prev.data = { ...prev.data, ...e.data };
                if (pid) prev.data.id = pid;
                prev.classes = `${prev.classes ?? ""} ${e.classes ?? ""}`.trim();
            }
        }
        const out = Array.from(map.values());
        ensureUniqueEdgeIds(out);
        return out;
    }

    function mergeMeta(existingMeta, incomingMeta) {
        const a = isObj(existingMeta) ? existingMeta : {};
        const b = isObj(incomingMeta) ? incomingMeta : {};
        return { ...a, ...b };
    }

    function mergeViewIntoMeta(meta0, g0) {
        const meta = isObj(meta0) ? { ...meta0 } : {};
        const rootView = isObj(g0?.view) ? clone(g0.view) : null;

        let metaViewObj = {};
        if (typeof meta.view === "string") metaViewObj.key = asStr(meta.view, "");
        else if (isObj(meta.view)) metaViewObj = { ...meta.view };

        if (rootView) metaViewObj = { ...metaViewObj, ...rootView };

        if (Object.keys(metaViewObj).length) {
            if (!metaViewObj.key && typeof meta.view === "string") metaViewObj.key = asStr(meta.view, "");
            meta.view = metaViewObj;
        }
        return meta;
    }

    function stampSession(metaIn) {
        const meta = isObj(metaIn) ? metaIn : {};
        const sess = {
            importer: asStr(meta.importer, "unknown"),
            sourceFiles: Array.isArray(meta.sourceFiles) ? meta.sourceFiles.map(String) : [],
            mode: asStr(meta.mode, ""),
            importedAt: asStr(meta.importedAt, nowIso()),
        };

        window.__onexus_meta = window.__onexus_meta || {};
        window.__onexus_meta.importSession = sess;

        // compat alias
        window.___onexus_meta = window.___onexus_meta || window.__onexus_meta;

        return sess;
    }

    /**
     * ✅ Single meta entry point for Set C.
     * applyMeta(graph, opts) returns graph with meta merged + normalized.
     */
    function applyMeta(graph, opts = {}) {
        const g0 = isObj(graph) ? graph : {};
        const metaPatch = isObj(opts) ? opts : {};

        const baseMeta = mergeMeta(g0.meta, metaPatch);
        const withView = mergeViewIntoMeta(baseMeta, g0);

        const meta = {
            ...withView,
            schema: asStr(withView.schema, "onexus"),
            importedAt: asStr(withView.importedAt, nowIso()),
            importer: asStr(withView.importer, asStr(metaPatch.importer, "unknown")),
            sourceFiles: Array.isArray(withView.sourceFiles)
                ? withView.sourceFiles.map(String)
                : (Array.isArray(metaPatch.sourceFiles) ? metaPatch.sourceFiles.map(String) : []),
            sourceKind: asStr(withView.sourceKind, asStr(metaPatch.sourceKind, "import")),
            mode: asStr(withView.mode, asStr(metaPatch.mode, "")),
        };

        // allow explicit view patch (e.g., { view:{ key:'circle-chord', arcOrder:[...] } })
        if (metaPatch.view && (typeof metaPatch.view === "string" || isObj(metaPatch.view))) {
            meta.view = mergeViewIntoMeta({ view: metaPatch.view }, { view: (meta.view && isObj(meta.view)) ? meta.view : null }).view;
        }

        g0.meta = meta;
        stampSession(meta);
        return g0;
    }

    function normalizeGraph(graph, metaPatch = {}) {
        const g0 = isObj(graph) ? graph : {};

        // ✅ ensure meta is always present & consistent
        applyMeta(g0, metaPatch);

        const nodesIn = Array.isArray(g0.elements?.nodes) ? g0.elements.nodes : [];
        const edgesIn = Array.isArray(g0.elements?.edges) ? g0.elements.edges : [];

        const nodesMap = new Map();
        for (const nw of nodesIn) {
            const n = normalizeNodeWrap(nw);
            if (!n) continue;
            nodesMap.set(n.data.id, n);
        }

        const edgesNorm = [];
        for (const ew of edgesIn) {
            const e = normalizeEdgeWrap(ew);
            if (!e) continue;
            edgesNorm.push(e);

            // auto-create endpoints if missing
            if (!nodesMap.has(e.data.source)) {
                nodesMap.set(
                    e.data.source,
                    normalizeNodeWrap({
                        data: {
                            id: e.data.source,
                            nodeType: "Component",
                            category: "Uncategorized",
                            label: { en: e.data.source, jp: e.data.source },
                            displayLabel: e.data.source,
                        },
                    })
                );
            }
            if (!nodesMap.has(e.data.target)) {
                nodesMap.set(
                    e.data.target,
                    normalizeNodeWrap({
                        data: {
                            id: e.data.target,
                            nodeType: "Component",
                            category: "Uncategorized",
                            label: { en: e.data.target, jp: e.data.target },
                            displayLabel: e.data.target,
                        },
                    })
                );
            }
        }

        const edges = dedupeEdges(edgesNorm);
        const nodes = Array.from(nodesMap.values());

        return { meta: g0.meta, elements: { nodes, edges } };
    }

    function tagElements(elements, metaIn) {
        const meta = isObj(metaIn) ? metaIn : {};
        const stamp = {
            importer: asStr(meta.importer, "unknown"),
            importedAt: asStr(meta.importedAt, nowIso()),
            sourceFiles: Array.isArray(meta.sourceFiles) ? meta.sourceFiles.map(String) : [],
            mode: asStr(meta.mode, ""),
        };
        const addTag = (wrap) => {
            if (!wrap || !wrap.data) return;
            wrap.data._import = { ...(wrap.data._import || {}), ...stamp };
        };
        (elements?.nodes || []).forEach(addTag);
        (elements?.edges || []).forEach(addTag);
        return elements;
    }

    ONX.import = ONX.import || {};
    ONX.import.normalizeGraph = normalizeGraph;
    ONX.import.stampSession = stampSession;
    ONX.import.tagElements = tagElements;
    ONX.import.applyMeta = applyMeta; // ✅ Set C export
    ONX.import.normalizeRelationship = normalizeRelationship;
    ONX.import.RELATIONSHIP_TRUTH_CLASSES = [...TRUTH_CLASSES];
})();
