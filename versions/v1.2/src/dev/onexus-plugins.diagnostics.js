/* =========================================================
 ONEXUS – Plugin Diagnostics (safe, optional UI)
 Exposes:
  - ONEXUS.plugins.debugDump()
  - ONEXUS.plugins.debugLastImport
========================================================= */
(function () {
    const ONX = window.ONEXUS = window.ONEXUS || {};
    const P = ONX.plugins;
    if (!P) return;

    // Track last import result if plugin layer exists
    P.debugLastImport = P.debugLastImport || null;

    // Wrap importFiles once to capture last result (no behavior change)
    if (typeof P.importFiles === "function" && !P.__debugWrapped) {
        P.__debugWrapped = true;
        const _importFiles = P.importFiles.bind(P);
        P.importFiles = async function (files, opts) {
            const res = await _importFiles(files, opts);
            try { P.debugLastImport = { at: new Date().toISOString(), files: Array.from(files || []).map(f => f?.name), opts, res }; } catch { }
            return res;
        };
    }

    P.debugDump = function () {
        const reg = P.registry ? Array.from(P.registry.keys()) : [];
        const importers = (P.importers || []).map(i => ({
            id: i.id, label: i.label, priority: i.priority, extensions: i.extensions, acceptMultiple: i.acceptMultiple
        }));
        console.groupCollapsed("[ONEXUS] Plugin Debug Dump");
        console.log("Registered plugins:", reg);
        console.log("Importers:", importers);
        console.log("EdgeTypeLabels:", P.edgeTypeLabels || {});
        console.log("TraceBehaviors:", P.traceBehaviors ? Array.from(P.traceBehaviors.keys()) : []);
        console.log("Explanations:", P.explanations ? Array.from(P.explanations.keys()) : []);
        console.log("LastImport:", P.debugLastImport);
        console.groupEnd();
        return { reg, importers, lastImport: P.debugLastImport };
    };
})();