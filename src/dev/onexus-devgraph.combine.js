/* =========================================================
ONEXUS – DevGraph Combine (DepGraph + HookGraph)
Requires:
- onexus-devgraph.common.js  (window.ONEXUS_DEVGRAPH)
- onexus-depgraph.js         (window.ONEXUS_DEPGRAPH.build/show)
- onexus-audit.hooks.js      (window.ONEXUS_HOOK_AUDIT.buildGraph)
========================================================= */
(function () {
    const DG = window.ONEXUS_DEVGRAPH;
    if (!DG?.mergeGraphs) return;

    const NS = (window.ONEXUS_DEVGRAPH_COMBINE = window.ONEXUS_DEVGRAPH_COMBINE || {});

    async function buildCombined(opts = {}) {
        const topN = opts.topN ?? 25;

        if (!window.ONEXUS_DEPGRAPH?.build) throw new Error("ONEXUS_DEPGRAPH.build missing");
        if (!window.ONEXUS_HOOK_AUDIT?.buildGraph) throw new Error("ONEXUS_HOOK_AUDIT.buildGraph missing");

        // Build both ONEXUS graphs
        const dep = await window.ONEXUS_DEPGRAPH.build({ includeDom: true, includeSymbols: true });
        const hook = window.ONEXUS_HOOK_AUDIT.buildGraph({ topN });

        const combined = DG.mergeGraphs(
            dep,
            hook,
            {
                kind: "onexus/devgraph-combined",
                note: "depgraph + hookgraph",
                builtAt: new Date().toISOString(),
            },
            { autoCreateEndpointNodes: true }
        );

        return combined;
    }

    async function exportCombined(opts = {}) {
        const g = await buildCombined(opts);
        const name = `onexus-devgraph_combined_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        DG.downloadGraph(g, name);
        return g;
    }

    async function showCombined(opts = {}) {
        const exportAlso = opts.exportAlso !== false; // default true per requirement (Alt+Click)
        const g = await buildCombined(opts);

        // Prefer reusing depgraph overlay instance if available
        if (window.ONEXUS_DEPGRAPH?.show) {
            await window.ONEXUS_DEPGRAPH.show({ includeDom: true, includeSymbols: true });

            const host = document.getElementById("onx-depgraph-overlay");
            const cy2 = host?.___depCy;

            if (cy2) {
                const els = [];
                (g.elements?.nodes || []).forEach((n) => els.push({ data: { ...n.data } }));
                (g.elements?.edges || []).forEach((e) => els.push({ data: { ...e.data } }));

                cy2.elements().remove();
                cy2.add(els);
                cy2.layout({ name: "cose", animate: true, padding: 30 }).run();
                setTimeout(() => { try { cy2.fit(undefined, 50); } catch { } }, 50);
            }
        }

        if (exportAlso) {
            const name = `onexus-devgraph_combined_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            DG.downloadGraph(g, name);
        }

        return g;
    }

    // Expose
    NS.buildCombined = buildCombined;
    NS.exportCombined = exportCombined;
    NS.showCombined = showCombined;

    // Back-compat aliases used by your existing binder code paths
    window.ONEXUS_DEVGRAPH = window.ONEXUS_DEVGRAPH || {};
    window.ONEXUS_DEVGRAPH.buildCombined = buildCombined;
    window.ONEXUS_DEVGRAPH.exportCombined = exportCombined;
    window.ONEXUS_DEVGRAPH.showCombined = showCombined;
})();