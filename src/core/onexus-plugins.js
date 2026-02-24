/* =========================================================
 ONEXUS – Plugins (basic registration layer)
 - NO hot-loading
 - NO permissions
 - NO dependency resolution
 - Plugins are just scripts that call ONEXUS.registerPlugin()
 - Supports: importers, edge type labels, trace behaviors, explanation templates
========================================================= */
(function () {
    const root = (window.ONEXUS = window.ONEXUS || {});
    const U = root.util || (root.util = {});

    const _plugins = (root.plugins = root.plugins || {
        registry: new Map(),     // id -> pluginDef
        importers: [],           // array of importer defs
        edgeTypeLabels: {},      // type -> {en,jp,...}
        traceBehaviors: new Map(), // id -> fn(ctx)
        explanations: new Map(), // id -> template object
    });

    function assert(cond, msg) { if (!cond) throw new Error(msg); }
    function normId(x) { return String(x || "").trim(); }
    function lc(x) { return String(x || "").toLowerCase(); }

    async function readFileHeadText(file, maxBytes = 8192) {
        const slice = file.slice(0, Math.min(maxBytes, file.size));
        const buf = await slice.arrayBuffer();
        try {
            return new TextDecoder("utf-8", { fatal: false }).decode(buf);
        } catch {
            return "";
        }
    }

    function fileExt(name) {
        const s = String(name || "");
        const i = s.lastIndexOf(".");
        return i >= 0 ? lc(s.slice(i + 1)) : "";
    }

    // ---- Extension API exposed to plugins ----
    const api = {
        // Importers ------------------------------------------------
        registerImporter(def) {
            assert(def && typeof def === "object", "registerImporter: def required");
            const id = normId(def.id);
            assert(id, "registerImporter: def.id required");

            const imp = {
                id,
                label: def.label || id,
                priority: Number.isFinite(def.priority) ? def.priority : 50, // higher wins
                // file routing hints
                extensions: Array.isArray(def.extensions) ? def.extensions.map(lc) : [],
                acceptMultiple: !!def.acceptMultiple,
                // capability checks
                canHandleFiles: typeof def.canHandleFiles === "function" ? def.canHandleFiles : null,
                canHandleText: typeof def.canHandleText === "function" ? def.canHandleText : null,
                // execution
                importFiles: typeof def.importFiles === "function" ? def.importFiles : null,
                importText: typeof def.importText === "function" ? def.importText : null,
                // misc
                help: def.help || "",
            };

            assert(imp.importFiles || imp.importText, `Importer '${id}' must implement importFiles or importText`);

            // replace if existing
            _plugins.importers = _plugins.importers.filter(x => x.id !== id);
            _plugins.importers.push(imp);
            _plugins.importers.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
            return imp;
        },

        listImporters() {
            return _plugins.importers.slice();
        },

        // Edge labels (i18n) --------------------------------------
        // Adds to window.__onexus_labels (used by graph-core.state.js)
        registerEdgeTypeLabels(type, labels) {
            const t = normId(type);
            assert(t, "registerEdgeTypeLabels: type required");
            assert(labels && typeof labels === "object", "registerEdgeTypeLabels: labels object required");

            _plugins.edgeTypeLabels[t] = { ...(_plugins.edgeTypeLabels[t] || {}), ...labels };

            // live-merge into existing label map used by state module
            const L = window.__onexus_labels;
            if (L && typeof L === "object") {
                for (const [lang, text] of Object.entries(labels)) {
                    if (!L[lang]) L[lang] = {};
                    L[lang][t] = text;
                }
                // re-apply current language to update displayType
                try {
                    const lang = window.__onexus_state?.language || "en";
                    window.setLanguage?.(lang);
                } catch { }
            }
            return true;
        },

        // Trace behaviors -----------------------------------------
        registerTraceBehavior(id, fn) {
            const k = normId(id);
            assert(k, "registerTraceBehavior: id required");
            assert(typeof fn === "function", "registerTraceBehavior: fn required");
            _plugins.traceBehaviors.set(k, fn);
            return true;
        },

        // Explanation templates -----------------------------------
        registerExplanationTemplate(id, templateObj) {
            const k = normId(id);
            assert(k, "registerExplanationTemplate: id required");
            assert(templateObj && typeof templateObj === "object", "registerExplanationTemplate: template required");
            _plugins.explanations.set(k, templateObj);
            return true;
        },
    };

    // ---- Plugin registration ----
    root.registerPlugin = function registerPlugin(pluginDef) {
        assert(pluginDef && typeof pluginDef === "object", "registerPlugin: pluginDef required");
        const id = normId(pluginDef.id);
        assert(id, "registerPlugin: pluginDef.id required");
        if (_plugins.registry.has(id)) {
            console.warn(`[ONEXUS/plugins] Plugin '${id}' already registered. Replacing.`);
        }
        _plugins.registry.set(id, pluginDef);

        // plugin can export register(api) or init(api)
        try {
            if (typeof pluginDef.register === "function") pluginDef.register(api);
            else if (typeof pluginDef.init === "function") pluginDef.init(api);
        } catch (e) {
            console.error(`[ONEXUS/plugins] Plugin '${id}' register/init failed`, e);
            throw e;
        }
        return pluginDef;
    };

    // ---- Import routing helpers ----
    async function scoreImporterForFiles(imp, files) {
        const exts = new Set(files.map(f => fileExt(f.name)));
        let score = imp.priority || 0;

        // extension match boost
        for (const x of imp.extensions) if (exts.has(x)) score += 25;

        // single/multi compatibility
        if (files.length > 1 && !imp.acceptMultiple) score -= 20;

        // deeper checks (filename/first bytes)
        try {
            if (imp.canHandleFiles) {
                const ok = await imp.canHandleFiles(files, { readFileHeadText, fileExt });
                if (!ok) return -1;
                score += 20;
            } else if (imp.canHandleText) {
                // use first file head
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

    root.plugins.getBestImporterForFiles = async function (files) {
        const list = _plugins.importers.slice();
        let best = null;
        let bestScore = -1;

        for (const imp of list) {
            const s = await scoreImporterForFiles(imp, files);
            if (s > bestScore) { bestScore = s; best = imp; }
        }
        return bestScore >= 0 ? best : null;
    };

    root.plugins.importFiles = async function (files, opts = {}) {
        const f = Array.from(files || []).filter(Boolean);
        if (!f.length) return { ok: false, reason: "no-files" };

        const imp = await root.plugins.getBestImporterForFiles(f);
        if (!imp) return { ok: false, reason: "no-matching-importer" };

        const ctx = {
            cy: window.cy,
            state: window.__onexus_state,
            meta: window.__onexus_meta,
            opts,
            util: { readFileHeadText, fileExt },
            api,
        };

        try {
            if (imp.importFiles) {
                await imp.importFiles(f, ctx);
            } else if (imp.importText) {
                const text = await f[0].text();
                await imp.importText(text, f[0], ctx);
            }
            return { ok: true, importer: imp.id };
        } catch (e) {
            console.error(`[ONEXUS/plugins] Importer '${imp.id}' failed`, e);
            return { ok: false, importer: imp.id, error: e };
        }
    };

})();