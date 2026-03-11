/* =========================================================
 ONEXUS – Plugins (registration + importer routing)
 - Plugins call ONEXUS.registerPlugin({ id, register(api) })
 - Supports: importers, edge type labels, trace behaviors, explanation templates
 - Provides: ONEXUS.plugins.importFiles(), .importFilesAs(), .getImporterCandidates()

 SET B PATCH:
 - Clean label registration: merge ONLY into window.__onexus_labels (core truth)
 - Harden importer scoring: stable, deterministic, extensible
 - Keep API backward compatible
========================================================= */
(function () {
    const root = (window.ONEXUS = window.ONEXUS || {});
    const U = (root.util = root.util || {});
    const P = (root.plugins = root.plugins || {
        registry: new Map(),      // id -> pluginDef
        importers: [],            // importer defs
        edgeTypeLabels: {},       // type -> { en, jp, ... }
        traceBehaviors: new Map(),// id -> fn(ctx)
        explanations: new Map(),  // id -> template
    });

    const LOG = window.ONEXUS_LOG || console;

    function assert(cond, msg) { if (!cond) throw new Error(msg); }
    const normId = (x) => String(x ?? "").trim();
    const lc = (x) => String(x ?? "").toLowerCase();
    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

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

    // ---------------------------------------------------------
    // ✅ Core label map integration (single target)
    // graph-core.state.js defines window.__onexus_labels. [4](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.mobile.filepicker.js)
    // ---------------------------------------------------------
    function getCoreLabelsMap() {
        // canonical
        if (window.__onexus_labels && isObj(window.__onexus_labels)) return window.__onexus_labels;
        // compat alias
        if (window.___onexus_labels && isObj(window.___onexus_labels)) return window.___onexus_labels;
        return null;
    }

    function mergeEdgeTypeLabelsIntoCore(type, labels) {
        const t = normId(type);
        if (!t) return false;

        const core = getCoreLabelsMap();
        if (!core) {
            // Core not ready yet; store in plugin registry and apply later.
            // (Autoloader loads plugins before graph-core.state.js sometimes in other pages.)
            return false;
        }

        for (const [lang, text] of Object.entries(labels || {})) {
            const L = String(lang ?? "").trim();
            if (!L) continue;
            if (!core[L] || typeof core[L] !== "object") core[L] = {};
            core[L][t] = String(text ?? "");
        }

        // Sync existing edges immediately
        try {
            const lang = window.__onexus_state?.language ?? window.___onexus_state?.language ?? "en";
            window.setLanguage?.(lang);
        } catch { }

        return true;
    }

    // ---------------------------------------------------------
    // Extension API exposed to plugins
    // ---------------------------------------------------------
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
                canHandleFiles: (typeof def.canHandleFiles === "function") ? def.canHandleFiles : null,
                canHandleText: (typeof def.canHandleText === "function") ? def.canHandleText : null,
                importFiles: (typeof def.importFiles === "function") ? def.importFiles : null,
                importText: (typeof def.importText === "function") ? def.importText : null,
                help: def.help ?? "",
            };

            assert(imp.importFiles || imp.importText, `Importer '${id}' must implement importFiles or importText`);

            // replace if exists
            P.importers = P.importers.filter(x => x.id !== id);
            P.importers.push(imp);

            // stable sort: priority desc, then id
            P.importers.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
            return imp;
        },

        registerEdgeTypeLabels(type, labels) {
            const t = normId(type);
            assert(t, "registerEdgeTypeLabels: type required");
            assert(labels && typeof labels === "object", "registerEdgeTypeLabels: labels object required");

            // Store in plugin registry
            P.edgeTypeLabels[t] = { ...(P.edgeTypeLabels[t] || {}), ...labels };

            // Apply to core if ready
            const ok = mergeEdgeTypeLabelsIntoCore(t, labels);

            // If core isn't ready yet, apply later on first graph init
            if (!ok) {
                try {
                    root.bus?.on?.("coreReady", () => {
                        mergeEdgeTypeLabelsIntoCore(t, labels);
                    });
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

    // ---------------------------------------------------------
    // Plugin registration
    // ---------------------------------------------------------
    root.registerPlugin = function registerPlugin(pluginDef) {
        assert(pluginDef && typeof pluginDef === "object", "registerPlugin: pluginDef required");
        const id = normId(pluginDef.id);
        assert(id, "registerPlugin: pluginDef.id required");

        if (P.registry.has(id)) {
            LOG.warn(`[ONEXUS/plugins] Plugin '${id}' already registered. Replacing.`);
        }

        P.registry.set(id, pluginDef);

        try {
            if (typeof pluginDef.register === "function") pluginDef.register(api);
            else if (typeof pluginDef.init === "function") pluginDef.init(api);
        } catch (e) {
            LOG.error(`[ONEXUS/plugins] Plugin '${id}' register/init failed`, e);
            throw e;
        }

        return pluginDef;
    };

    // ---------------------------------------------------------
    // Public: list importers
    // ---------------------------------------------------------
    P.listImporters = function listImporters() {
        return (P.importers || []).slice();
    };

    // ---------------------------------------------------------
    // Importer scoring (hardened)
    // - base: priority
    // - extension match: +25 per match
    // - multi-file mismatch: -25 (if multiple and !acceptMultiple)
    // - canHandleFiles: +30 if true
    // - canHandleText: +20 if true
    // ---------------------------------------------------------
    async function scoreImporterForFiles(imp, files) {
        const f = Array.from(files || []).filter(Boolean);
        if (!f.length) return -1;

        const exts = new Set(f.map(x => fileExt(x.name)));
        let score = Number.isFinite(imp.priority) ? imp.priority : 50;

        // extension boost
        if (Array.isArray(imp.extensions) && imp.extensions.length) {
            for (const x of imp.extensions.map(lc)) {
                if (exts.has(x)) score += 25;
            }
        }

        // multi-file penalty
        if (f.length > 1 && !imp.acceptMultiple) score -= 25;

        // sniffer bonus
        try {
            if (typeof imp.canHandleFiles === "function") {
                const ok = await imp.canHandleFiles(f, { readFileHeadText, fileExt });
                if (!ok) return -1;
                score += 30;
            } else if (typeof imp.canHandleText === "function") {
                const head = await readFileHeadText(f[0]);
                const ok = await imp.canHandleText(head, f[0], { fileExt });
                if (!ok) return -1;
                score += 20;
            }
        } catch (e) {
            LOG.warn(`[ONEXUS/plugins] Importer '${imp.id}' canHandle failed`, e);
            return -1;
        }

        return score;
    }

    P.getBestImporterForFiles = async function getBestImporterForFiles(files) {
        const list = P.listImporters();
        const f = Array.from(files || []).filter(Boolean);
        if (!f.length) return null;

        let best = null;
        let bestScore = -1;

        for (const imp of list) {
            const s = await scoreImporterForFiles(imp, f);
            if (s > bestScore) { bestScore = s; best = imp; }
        }

        return bestScore >= 0 ? best : null;
    };

    P.getImporterCandidates = async function getImporterCandidates(files) {
        const f = Array.from(files || []).filter(Boolean);
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

    // ---------------------------------------------------------
    // Import helpers
    // ---------------------------------------------------------
    P.importFiles = async function importFiles(files, opts = {}) {
        const f = Array.from(files || []).filter(Boolean);
        if (!f.length) return { ok: false, reason: "no-files" };

        const imp = await P.getBestImporterForFiles(f);
        if (!imp) return { ok: false, reason: "no-matching-importer" };

        return P.importFilesAs(imp.id, f, opts);
    };

    P.importFilesAs = async function importFilesAs(importerId, files, opts = {}) {
        const f = Array.from(files || []).filter(Boolean);
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
            api, // always available to importers
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
            LOG.error(`[ONEXUS/plugins] importFilesAs('${imp.id}') failed`, e);
            return { ok: false, importer: imp.id, error: e };
        }
    };

    // ---------------------------------------------------------
    // Apply pre-registered plugin edge labels once core is ready
    // (core defines __onexus_labels in graph-core.state.js). [4](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.mobile.filepicker.js)
    // ---------------------------------------------------------
    function applyAllQueuedLabelsIfCoreReady() {
        const core = getCoreLabelsMap();
        if (!core) return false;
        try {
            for (const [type, labels] of Object.entries(P.edgeTypeLabels || {})) {
                mergeEdgeTypeLabelsIntoCore(type, labels);
            }
        } catch (e) {
            LOG.warn("[ONEXUS/plugins] applying queued labels failed", e);
        }
        return true;
    }

    // Call once after DOM boot (core state comes after onexus-style + graph-core.state in index.html) [7](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-edgescsv.plugin.js)[4](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.mobile.filepicker.js)
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(applyAllQueuedLabelsIfCoreReady, 0));
    } else {
        setTimeout(applyAllQueuedLabelsIfCoreReady, 0);
    }
})();