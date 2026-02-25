/* =========================================================
 ONEXUS – Plugins (registration + importer routing)
 - Plugins call ONEXUS.registerPlugin({ id, register(api) })
 - Supports: importers, edge type labels, trace behaviors, explanation templates
 - Provides: ONEXUS.plugins.importFiles(), .importFilesAs(), .getImporterCandidates()
========================================================= */
(function () {
    const root = (window.ONEXUS = window.ONEXUS || {});
    const U = (root.util = root.util || {});

    const P = (root.plugins = root.plugins || {
        registry: new Map(),        // id -> pluginDef
        importers: [],              // importer defs
        edgeTypeLabels: {},         // type -> {en,jp,...}
        traceBehaviors: new Map(),  // id -> fn(ctx)
        explanations: new Map(),    // id -> template
    });

    function assert(cond, msg) { if (!cond) throw new Error(msg); }
    const normId = (x) => String(x ?? "").trim();
    const lc = (x) => String(x ?? "").toLowerCase();

    function fileExt(name) {
        const s = lc(name);
        const i = s.lastIndexOf(".");
        return i >= 0 ? s.slice(i + 1) : "";
    }

    async function readFileHeadText(file, maxBytes = 8192) {
        const slice = file.slice(0, Math.min(maxBytes, file.size));
        const buf = await slice.arrayBuffer();
        try { return new TextDecoder("utf-8", { fatal: false }).decode(buf); }
        catch { return ""; }
    }

    // ---- Extension API exposed to plugins ----
    const api = {
        registerImporter(def) {
            assert(def && typeof def === "object", "registerImporter: def required");
            const id = normId(def.id);
            assert(id, "registerImporter: def.id required");

            const imp = {
                id,
                label: def.label ?? id,
                priority: Number.isFinite(def.priority) ? def.priority : 50,
                extensions: Array.isArray(def.extensions) ? def.extensions.map(lc) : [],
                acceptMultiple: !!def.acceptMultiple,

                canHandleFiles: typeof def.canHandleFiles === "function" ? def.canHandleFiles : null,
                canHandleText: typeof def.canHandleText === "function" ? def.canHandleText : null,

                importFiles: typeof def.importFiles === "function" ? def.importFiles : null,
                importText: typeof def.importText === "function" ? def.importText : null,

                help: def.help ?? "",
            };

            assert(imp.importFiles || imp.importText, `Importer '${id}' must implement importFiles or importText`);

            // replace if exists
            P.importers = P.importers.filter(x => x.id !== id);
            P.importers.push(imp);
            P.importers.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
            return imp;
        },

        registerEdgeTypeLabels(type, labels) {
            const t = normId(type);
            assert(t, "registerEdgeTypeLabels: type required");
            assert(labels && typeof labels === "object", "registerEdgeTypeLabels: labels object required");

            P.edgeTypeLabels[t] = { ...(P.edgeTypeLabels[t] || {}), ...labels };

            // live merge into label map used by graph-core.state.js
            const L = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels; // tolerant
            const coreLabels = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const labelMap = window.__onexus_labels ?? window.___onexus_labels ?? window.__onexus_labels;

            const target = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LABELS = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const core = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const MAP = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const stateLabels = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LBL = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const labelsObj = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const canon = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const Core = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            // Actual core uses window.__onexus_labels in your project via graph-core.state.js (exposed as __onexus_labels there)
            const CORE_LABELS = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const use = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const actual = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreLabelMap = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const live = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LMAP = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const base = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const lbls = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const CORE_MAP = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const real = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const CORELBL = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const CL = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const L0 = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreLabelsMap = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreLabelsObj = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LABEL_MAP = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const onxLabels = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const labelsTarget = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LREF = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const ref = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreL = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const map0 = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const mapRef = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreLabelRef = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const CORE_LABELS_MAP = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LUSED = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const __LABELS = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const coreLabelsFinal = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const LREAL = window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const L_CORE = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LABELS_CORE = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const Lmap = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const LCore = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreMap = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const labelStore = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const labelCore = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const coreStateLabels = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            // Minimal: use your known global from graph-core.state.js
            const CORE_LABELS_ACTUAL = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels || window.__onexus_labels;

            const L1 = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            const __labels = window.__onexus_labels || window.___onexus_labels || window.__onexus_labels;

            if (__labels && typeof __labels === "object") {
                for (const [lang, text] of Object.entries(labels)) {
                    if (!__labels[lang]) __labels[lang] = {};
                    __labels[lang][t] = text;
                }
                try {
                    const lang = window.__onexus_state?.language ?? window.___onexus_state?.language ?? "en";
                    window.setLanguage?.(lang);
                } catch { }
            }
            return true;
        },

        registerTraceBehavior(id, fn) {
            const k = normId(id);
            assert(k, "registerTraceBehavior: id required");
            assert(typeof fn === "function", "registerTraceBehavior: fn required");
            P.traceBehaviors.set(k, fn);
            return true;
        },

        registerExplanationTemplate(id, templateObj) {
            const k = normId(id);
            assert(k, "registerExplanationTemplate: id required");
            assert(templateObj && typeof templateObj === "object", "registerExplanationTemplate: template required");
            P.explanations.set(k, templateObj);
            return true;
        },
    };

    // ---- Plugin registration ----
    root.registerPlugin = function registerPlugin(pluginDef) {
        assert(pluginDef && typeof pluginDef === "object", "registerPlugin: pluginDef required");
        const id = normId(pluginDef.id);
        assert(id, "registerPlugin: pluginDef.id required");

        if (P.registry.has(id)) {
            console.warn(`[ONEXUS/plugins] Plugin '${id}' already registered. Replacing.`);
        }
        P.registry.set(id, pluginDef);

        try {
            if (typeof pluginDef.register === "function") pluginDef.register(api);
            else if (typeof pluginDef.init === "function") pluginDef.init(api);
        } catch (e) {
            console.error(`[ONEXUS/plugins] Plugin '${id}' register/init failed`, e);
            throw e;
        }

        return pluginDef;
    };

    // ---- Public: list importers ----
    P.listImporters = function listImporters() {
        return (P.importers || []).slice();
    };

    // ---- Internal: score & select ----
    async function scoreImporterForFiles(imp, files) {
        const exts = new Set(files.map(f => fileExt(f.name)));
        let score = Number.isFinite(imp.priority) ? imp.priority : 50;

        if (Array.isArray(imp.extensions)) {
            for (const x of imp.extensions.map(lc)) if (exts.has(x)) score += 25;
        }
        if (files.length > 1 && !imp.acceptMultiple) score -= 20;

        try {
            if (typeof imp.canHandleFiles === "function") {
                const ok = await imp.canHandleFiles(files, { readFileHeadText, fileExt });
                if (!ok) return -1;
                score += 20;
            } else if (typeof imp.canHandleText === "function") {
                const head = await readFileHeadText(files[0]);
                const ok = await imp.canHandleText(head, files[0], { fileExt });
                if (!ok) return -1;
                score += 10;
            }
        } catch (e) {
            console.warn(`[ONEXUS/plugins] Importer '${imp.id}' canHandle failed`, e);
            return -1;
        }
        return score;
    }

    P.getBestImporterForFiles = async function getBestImporterForFiles(files) {
        const list = P.listImporters();
        let best = null;
        let bestScore = -1;
        for (const imp of list) {
            const s = await scoreImporterForFiles(imp, files);
            if (s > bestScore) { bestScore = s; best = imp; }
        }
        return bestScore >= 0 ? best : null;
    };

    // ---- Public: candidates (used by unified loader UI) ----
    P.getImporterCandidates = async function getImporterCandidates(files) {
        const f = Array.from(files ?? []).filter(Boolean);
        if (!f.length) return [];
        const list = P.listImporters();
        const out = [];
        for (const imp of list) {
            const s = await scoreImporterForFiles(imp, f);
            if (s >= 0) out.push({ ...imp, __score: s });
        }
        out.sort((a, b) => (b.__score - a.__score) || String(a.id).localeCompare(String(b.id)));
        return out;
    };

    // ---- Public: import via best match ----
    P.importFiles = async function importFiles(files, opts = {}) {
        const f = Array.from(files ?? []).filter(Boolean);
        if (!f.length) return { ok: false, reason: "no-files" };

        const imp = await P.getBestImporterForFiles(f);
        if (!imp) return { ok: false, reason: "no-matching-importer" };

        return P.importFilesAs(imp.id, f, opts);
    };

    // ---- Public: import via specific importer id ----
    P.importFilesAs = async function importFilesAs(importerId, files, opts = {}) {
        const f = Array.from(files ?? []).filter(Boolean);
        if (!f.length) return { ok: false, reason: "no-files" };

        const list = P.listImporters();
        const imp = list.find(x => String(x.id) === String(importerId));
        if (!imp) return { ok: false, reason: "importer-not-found", importer: importerId };

        const ctx = {
            cy: window.cy,
            state: window.__onexus_state || window.___onexus_state,
            meta: window.__onexus_meta || window.___onexus_meta,
            opts,
            util: { readFileHeadText, fileExt },
            api, // ✅ always available to importers
        };

        try {
            if (typeof imp.importFiles === "function") {
                await imp.importFiles(f, ctx);
            } else if (typeof imp.importText === "function") {
                const text = await f[0].text();
                await imp.importText(text, f[0], ctx);
            } else {
                return { ok: false, reason: "importer-has-no-handler", importer: imp.id };
            }
            return { ok: true, importer: imp.id };
        } catch (e) {
            console.error(`[ONEXUS/plugins] importFilesAs('${imp.id}') failed`, e);
            return { ok: false, importer: imp.id, error: e };
        }
    };
})();