/* =========================================================
 ONEXUS – Import Normalizer & Metadata Stamping
 - Canonicalizes importer outputs into ONEXUS schema
 - Stamps meta.importer/sourceFiles/importedAt/importSession
 - Optional per-element tagging: data._import
 Safe:
 - Does not require cy
 - Works before/after graph-core.state.js
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    ONX.util = ONX.util || {};

    const U = ONX.util;
    const clone =
        U.clone ||
        function (x) {
            return typeof structuredClone === "function"
                ? structuredClone(x)
                : JSON.parse(JSON.stringify(x));
        };

    const idSafe =
        U.idSafe ||
        function (s) {
            return String(s ?? "").replace(/[^\w\-:.]+/g, "_");
        };

    function nowIso() {
        return new Date().toISOString();
    }

    function asStr(x, fallback = "") {
        const s = String(x ?? "").trim();
        return s ? s : fallback;
    }

    function ensureLabelObject(label, fallback) {
        // Accept object {en,jp} or string; normalize to {en,jp}
        if (label && typeof label === "object") {
            const en = asStr(label.en, asStr(fallback, ""));
            const jp = asStr(label.jp, en);
            return { en, jp };
        }
        const en = asStr(label, asStr(fallback, ""));
        return { en, jp: en };
    }

    function normalizeCategory(d) {
        // Category required by your validator: category OR revitCategory
        const cat = asStr(d.category, "");
        const rev = asStr(d.revitCategory, "");
        return cat || rev || "Uncategorized";
    }

    function normalizeNodeWrap(nw, opts) {
        const d0 = (nw && nw.data) ? nw.data : (nw || {});
        const id = asStr(d0.id, "");
        if (!id) return null;

        const nodeType = asStr(d0.nodeType, "Component");
        const category = normalizeCategory(d0);
        const label = ensureLabelObject(d0.label, d0.displayLabel ?? id);

        // displayLabel: prefer current language if state exists
        const lang = window.___onexus_state?.language || window.__onexus_state?.language || "en";
        const displayLabel = asStr(d0.displayLabel, label[lang] ?? label.en ?? id);

        const data = {
            ...d0,
            id,
            nodeType,
            category,
            label,
            displayLabel
        };

        return { data, classes: nw?.classes ?? "" };
    }

    function normalizePhase(ph) {
        if (ph == null) return [];
        if (Array.isArray(ph)) return ph.map(x => asStr(x, "")).filter(Boolean);
        const s = asStr(ph, "");
        if (!s) return [];
        // allow "\n" delimited phases (CSV export)
        return s.split(/\n/g).map(x => asStr(x, "")).filter(Boolean);
    }

    function normalizeEdgeWrap(ew, opts) {
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

        // displayType is computed by setLanguage(), but seed it safely
        const labelsMap =
            window.__onexus_labels?.[window.__onexus_state?.language ?? "en"] ||
            window.__onexus_labels?.en ||
            {};
        const displayType = asStr(d0.displayType, labelsMap[type] ?? type);

        const data = {
            ...d0,
            id: asStr(d0.id, ""), // may be fixed in dedupe pass
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
            displayType
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
                // merge: keep existing id if set; otherwise allow newer fields
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
        const a = (existingMeta && typeof existingMeta === "object") ? existingMeta : {};
        const b = (incomingMeta && typeof incomingMeta === "object") ? incomingMeta : {};
        // last-write-wins for simple keys, but preserve schema/kind if present
        return { ...a, ...b };
    }

    function stampSession(metaIn) {
        // Persist a single "session" bucket in __onexus_meta for audits/exports
        const meta = (metaIn && typeof metaIn === "object") ? metaIn : {};
        const sess = {
            importer: asStr(meta.importer, "unknown"),
            sourceFiles: Array.isArray(meta.sourceFiles) ? meta.sourceFiles.map(String) : [],
            mode: asStr(meta.mode, ""),
            importedAt: asStr(meta.importedAt, nowIso())
        };
        window.__onexus_meta = window.__onexus_meta || {};
        window.__onexus_meta.importSession = sess;
        return sess;
    }

    function normalizeGraph(graph, metaPatch = {}) {
        const g0 = (graph && typeof graph === "object") ? graph : {};
        const meta0 = mergeMeta(g0.meta, metaPatch);

        // Standard meta fields (safe additions)
        const meta = {
            ...meta0,
            schema: asStr(meta0.schema, "onexus"),
            importedAt: asStr(meta0.importedAt, nowIso()),
            importer: asStr(meta0.importer, metaPatch.importer ?? "unknown"),
            sourceFiles: Array.isArray(meta0.sourceFiles) ? meta0.sourceFiles : (metaPatch.sourceFiles ?? []),
            sourceKind: asStr(meta0.sourceKind, metaPatch.sourceKind ?? "import")
        };

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
            // auto-create endpoints if missing (validator-friendly)
            if (!nodesMap.has(e.data.source)) {
                nodesMap.set(e.data.source, normalizeNodeWrap({
                    data: { id: e.data.source, nodeType: "Component", category: "Uncategorized", label: { en: e.data.source, jp: e.data.source }, displayLabel: e.data.source }
                }));
            }
            if (!nodesMap.has(e.data.target)) {
                nodesMap.set(e.data.target, normalizeNodeWrap({
                    data: { id: e.data.target, nodeType: "Component", category: "Uncategorized", label: { en: e.data.target, jp: e.data.target }, displayLabel: e.data.target }
                }));
            }
        }

        const edges = dedupeEdges(edgesNorm);
        const nodes = Array.from(nodesMap.values());

        // stamp session bucket (also used by export/persist later)
        stampSession(meta);

        return { meta, elements: { nodes, edges } };
    }

    function tagElements(elements, metaIn) {
        const meta = (metaIn && typeof metaIn === "object") ? metaIn : {};
        const stamp = {
            importer: asStr(meta.importer, "unknown"),
            importedAt: asStr(meta.importedAt, nowIso()),
            sourceFiles: Array.isArray(meta.sourceFiles) ? meta.sourceFiles.map(String) : [],
            mode: asStr(meta.mode, "")
        };

        const addTag = (wrap) => {
            if (!wrap || !wrap.data) return;
            wrap.data._import = { ...(wrap.data._import || {}), ...stamp };
        };

        (elements?.nodes || []).forEach(addTag);
        (elements?.edges || []).forEach(addTag);
        return elements;
    }

    // Public API
    ONX.import = ONX.import || {};
    ONX.import.normalizeGraph = normalizeGraph;
    ONX.import.stampSession = stampSession;
    ONX.import.tagElements = tagElements;
})();