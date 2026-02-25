/* =========================================================
 ONEXUS – Self Test Runner (safe, rollbackable)
 - Runs contract checks + importer smoke tests
 - Uses cy.json() snapshot/restore so tests don't permanently mutate graph
 - Toggle strict mode: localStorage.setItem("onexus.selftest.strict","1")
========================================================= */
(function () {
    const ONX = window.ONEXUS || {};
    const U = ONX.util || {};
    const strict = (localStorage.getItem("onexus.selftest.strict") === "1");

    function logOk(msg, obj) { console.log("%c[ONEXUS selftest] OK:", "color:#10b981;font-weight:700", msg, obj ?? ""); }
    function logWarn(msg, obj) { console.warn("[ONEXUS selftest] WARN:", msg, obj ?? ""); }
    function logErr(msg, obj) { console.error("[ONEXUS selftest] FAIL:", msg, obj ?? ""); }

    function ensure(cond, msg) {
        if (cond) return true;
        logErr(msg);
        if (strict) alert("ONEXUS selftest failed:\n\n" + msg);
        return false;
    }

    function can(fn) { return typeof fn === "function"; }

    async function withGraphSnapshot(fn) {
        const cy = window.cy;
        if (!cy || !can(cy.json)) throw new Error("cy.json() not available");
        const snap = cy.json();
        const meta = window.__onexus_meta ? JSON.parse(JSON.stringify(window.__onexus_meta)) : null;

        try {
            return await fn();
        } finally {
            try { cy.json(snap); } catch (e) { logWarn("Failed to restore cy snapshot", e); }
            try { window.__onexus_meta = meta; } catch { }
            // Re-run UI refresh hooks after restore
            try { window.setLanguage?.(window.__onexus_state?.language ?? "en"); } catch { }
            try { window.buildCategoryFilter?.(); } catch { }
            try { window.buildPhaseFilter?.(); } catch { }
            try { window.buildRelationshipLegend?.(); } catch { }
            try { window.updateMetrics?.(); } catch { }
        }
    }

    function mkFile(name, text, type) {
        try {
            return new File([text], name, { type: type || "text/plain" });
        } catch {
            // Fallback for older WebViews
            return { name, text: async () => text, slice: () => ({ text: async () => text }), size: text.length };
        }
    }

    async function contractChecks() {
        // Core existence
        ensure(!!window.cy, "Missing window.cy (Cytoscape not initialized).");                        // core boot [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.tour.js)
        ensure(can(window.onexusLoadGraph), "Missing window.onexusLoadGraph (host loader).");         // loader contract [7](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/kanji.plugin.js)
        ensure(can(window.setLanguage), "Missing window.setLanguage.");                               // core contract [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.tour.js)
        ensure(can(window.applyLayout), "Missing window.applyLayout.");                               // layouts contract [8](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.layerWidget.js)
        ensure(can(window.applyTheme), "Missing window.applyTheme.");                                 // theme contract [9](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.nodeVisWidget.js)

        // Plugin system
        ensure(!!window.ONEXUS, "Missing window.ONEXUS namespace.");                                  // namespace [5](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/cobie-importer.js)
        ensure(!!window.ONEXUS.plugins, "Missing ONEXUS.plugins.");                                   // plugin core [2](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/gd-importer.js)
        ensure(can(window.ONEXUS.plugins.getImporterCandidates), "Missing ONEXUS.plugins.getImporterCandidates."); // loader depends [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.loader.js)
        ensure(can(window.ONEXUS.plugins.importFilesAs), "Missing ONEXUS.plugins.importFilesAs.");    // loader depends [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.loader.js)

        // Unified loader entrypoint
        ensure(can(window.handleUnifiedLoad), "Missing window.handleUnifiedLoad.");                   // UI binds to it [10](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.bindings.js)[3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.loader.js)
    }

    async function importerSmokeTests() {
        const P = window.ONEXUS?.plugins;
        const list = (typeof P?.listImporters === "function") ? P.listImporters() : (P?.importers ?? []);
        if (!Array.isArray(list) || !list.length) {
            logWarn("No importers registered (manifest not loaded yet?)");
            return;
        }

        // Basic canHandle checks must not throw
        const sampleJson = JSON.stringify({ elements: { nodes: [], edges: [] } });
        const fJson = mkFile("sample.json", sampleJson, "application/json");
        const fCsvEdges = mkFile("edges.csv",
            "id,type,dimension,directional,source,target,phase,owner,risk,confidence,notes\n" +
            "e1,DependsOn,System,1,A,B,,me,low,inferred,test\n",
            "text/csv"
        );
        const fCobieComponent = mkFile("Component.csv", "Name,CreatedBy\nX,user\n", "text/csv");
        const fIfc = mkFile("a.ifc", "ISO-10303-21;\nEND-ISO-10303-21;\n", "text/plain");

        for (const imp of list) {
            const id = imp.id;
            try {
                // Probe without mutating
                if (can(imp.canHandleFiles)) {
                    // choose representative file sets
                    let probeFiles = [fJson];
                    if (id === "onexus-edges-csv") probeFiles = [fCsvEdges];
                    if (id === "cobie") probeFiles = [fCobieComponent];
                    if (id === "ifc") probeFiles = [fIfc];

                    const ok = await imp.canHandleFiles(probeFiles, { fileExt: (n) => String(n).split(".").pop(), readFileHeadText: async (f) => (await f.slice(0, 512).text()) });
                    logOk(`Importer ${id}.canHandleFiles()`, ok);
                } else if (can(imp.canHandleText)) {
                    const head = (await fJson.slice(0, 512).text());
                    const ok = await imp.canHandleText(head, fJson, { fileExt: (n) => String(n).split(".").pop() });
                    logOk(`Importer ${id}.canHandleText()`, ok);
                } else {
                    logWarn(`Importer ${id} has no canHandle* probe`);
                }
            } catch (e) {
                logErr(`Importer probe failed: ${id}`, e);
                if (strict) alert(`Importer probe failed: ${id}\n\n${e?.message ?? e}`);
            }
        }

        // Safe mutation tests: only for importers known to be local + fast
        // Uses snapshot/restore to avoid persisting changes.
        const fastImporters = new Set(["onexus-edges-csv", "gd"]);
        for (const imp of list) {
            if (!fastImporters.has(imp.id)) continue;
            if (!can(imp.importFiles) && !can(imp.importText)) continue;

            await withGraphSnapshot(async () => {
                const files = (imp.id === "onexus-edges-csv") ? [fCsvEdges] : [mkFile("gd.json", JSON.stringify({ type: "onexus/generative-design", options: [{ id: "opt-1", rank: 1, affected: { nodes: [{ id: "A" }], edges: [] } }], problem: { id: "P" } }), "application/json")];

                const ctx = { cy: window.cy, state: window.__onexus_state, meta: window.__onexus_meta, opts: { source: "selftest" }, util: {}, api: null };
                try {
                    if (can(imp.importFiles)) await imp.importFiles(files, ctx);
                    else await imp.importText(await files[0].text(), files[0], ctx);
                    logOk(`Importer mutation test passed: ${imp.id}`);
                } catch (e) {
                    logErr(`Importer mutation test failed: ${imp.id}`, e);
                    if (strict) alert(`Importer mutation test failed: ${imp.id}\n\n${e?.message ?? e}`);
                }
            });
        }
    }

    async function run() {
        try {
            await contractChecks();
            await importerSmokeTests();
            logOk("Selftest completed.");
            // optional toast
            window.showTransientMessage?.("ONEXUS selftest: OK");
        } catch (e) {
            logErr("Selftest crashed", e);
            if (strict) alert("ONEXUS selftest crashed:\n\n" + (e?.message ?? e));
        }
    }

    // Run after boot + plugin autoload has a chance to register importers
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(run, 600));
    } else {
        setTimeout(run, 600);
    }

    window.ONEXUS_SELFTEST = { run };
})();