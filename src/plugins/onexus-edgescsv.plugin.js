/* =========================================================
 ONEXUS Plugin – ONEXUS Edges CSV Importer
 - Supports CSV exported by exportCSV() (id,type,dimension,directional,source,target,...)
 - No deps, browser-safe
 - Registers an importer via ONEXUS.registerPlugin()
 - Also exposes window.ONEXUS_EDGESCSV for legacy callers
========================================================= */
(function () {
    // ---- CSV line parser (quoted fields with commas/dquotes) ----
    function parseCsvLine(line) {
        const out = [];
        let cur = "", q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; }
                    else q = false;
                } else cur += ch;
            } else {
                if (ch === '"') q = true;
                else if (ch === ",") { out.push(cur); cur = ""; }
                else cur += ch;
            }
        }
        out.push(cur);
        return out;
    }

    function isEdgesCsvHeader(firstLineLower) {
        // strict enough for your exporter header
        return firstLineLower.includes("id,type,dimension,directional,source,target");
    }

    function parseEdgesCsvToGraph(csvText, { keepExistingNodes = true } = {}) {
        const lines = String(csvText ?? "").split(/\r?\n/).filter(Boolean);
        const headerLine = lines.shift() ?? "";
        const headerLower = headerLine.toLowerCase();

        if (!isEdgesCsvHeader(headerLower)) {
            throw new Error("Not an ONEXUS edges CSV (header mismatch).");
        }

        const header = headerLine.split(",").map(h => h.trim().toLowerCase());
        const idx = Object.fromEntries(header.map((h, i) => [h, i]));

        const edges = [];
        const nodesSet = new Set();

        for (const L of lines) {
            const cols = parseCsvLine(L);
            const get = (k) => cols[idx[k]] ?? "";

            const source = get("source");
            const target = get("target");
            if (!source || !target) continue;

            const directionalRaw = String(get("directional")).trim().toLowerCase();
            const directional = (directionalRaw === "1" || directionalRaw === "true" || directionalRaw === "yes");

            edges.push({
                data: {
                    id: get("id") || `e_${source}_${target}_${edges.length + 1}`,
                    type: get("type") || "DependsOn",
                    dimension: get("dimension") || "System",
                    directional,
                    source,
                    target,
                    phase: String(get("phase") || "").split(/\n/).filter(Boolean),
                    owner: get("owner") || "",
                    risk: get("risk") || "",
                    confidence: get("confidence") || "",
                    notes: get("notes") || ""
                }
            });

            nodesSet.add(source);
            nodesSet.add(target);
        }

        // Create missing nodes if desired
        const cy = window.cy;
        const existingIds = new Set((keepExistingNodes && cy) ? cy.nodes().map(n => n.id()) : []);
        const nodes = [];

        for (const id of nodesSet) {
            if (!existingIds.has(id)) {
                nodes.push({
                    data: {
                        id,
                        nodeType: "Component",
                        category: "Uncategorized",
                        label: { en: id, jp: id },
                        displayLabel: id
                    }
                });
            }
        }

        return { elements: { nodes, edges } };
    }

    async function importEdgesCsvFiles(files) {
        const csvFiles = Array.from(files || []).filter(f => (f?.name || "").toLowerCase().endsWith(".csv"));
        if (!csvFiles.length) throw new Error("No CSV files provided.");

        // NEW: stamp import session meta
        try {
            window.ONEXUS?.import?.stampSession?.({
                importer: "onexus-edges-csv",
                sourceFiles: Array.from(files ?? []).map(f => f?.name).filter(Boolean),
                importedAt: new Date().toISOString()
            });
        } catch { }

        // Combine multiple files by concatenating edge lists into one graph (nodes union)
        const graphs = [];
        for (const f of csvFiles) {
            const text = await f.text();
            graphs.push(parseEdgesCsvToGraph(text, { keepExistingNodes: true }));
        }

        // Merge graphs (simple union)
        const nodesMap = new Map();
        const edges = [];
        const usedEdgeIds = new Set();

        for (const g of graphs) {
            for (const n of (g.elements?.nodes ?? [])) {
                const id = n?.data?.id;
                if (!id) continue;
                nodesMap.set(id, n);
            }
            for (const e of (g.elements?.edges ?? [])) {
                const d = e?.data || {};
                if (!d.source || !d.target || !d.type || !d.dimension) continue;
                let eid = d.id || `e_${d.source}_${d.type}_${d.target}_${edges.length + 1}`;
                if (usedEdgeIds.has(eid)) {
                    let k = 2;
                    while (usedEdgeIds.has(`${eid}-${k}`)) k++;
                    eid = `${eid}-${k}`;
                }
                usedEdgeIds.add(eid);
                edges.push({ data: { ...d, id: eid } });
            }
        }

        const graph = { elements: { nodes: Array.from(nodesMap.values()), edges } };

        // Load
        if (typeof window.onexusLoadGraph === "function") {
            window.onexusLoadGraph(graph);
        } else if (window.cy) {
            const cy = window.cy;
            cy.elements().remove();
            cy.add(graph.elements.nodes);
            cy.add(graph.elements.edges);
            window.setLanguage?.(window.__onexus_state?.language || "en");
            window.buildCategoryFilter?.();
            window.buildPhaseFilter?.();
            window.applyLayout?.("default");
            cy.fit(undefined, 50);
            window.buildRelationshipLegend?.();
            window.updateMetrics?.();
        }
    }

    // ---- Expose legacy helper (so loader can delegate without owning parsing) ----
    window.ONEXUS_EDGESCSV = window.ONEXUS_EDGESCSV || {};
    window.ONEXUS_EDGESCSV.isEdgesCsvHeader = isEdgesCsvHeader;
    window.ONEXUS_EDGESCSV.parseEdgesCsvToGraph = parseEdgesCsvToGraph;
    window.ONEXUS_EDGESCSV.importFiles = importEdgesCsvFiles;
    window.ONEXUS_EDGESCSV.importText = function (csvText) {
        const graph = parseEdgesCsvToGraph(csvText, { keepExistingNodes: true });
        if (typeof window.onexusLoadGraph === "function") window.onexusLoadGraph(graph);
        else if (window.cy) {
            const cy = window.cy;
            cy.elements().remove();
            cy.add(graph.elements.nodes);
            cy.add(graph.elements.edges);
            window.setLanguage?.(window.__onexus_state?.language || "en");
            window.buildCategoryFilter?.();
            window.buildPhaseFilter?.();
            window.applyLayout?.("default");
            cy.fit(undefined, 50);
            window.buildRelationshipLegend?.();
            window.updateMetrics?.();
        }
    };

    // ---- Register as a plugin importer ----
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    ONX.registerPlugin({
        id: "onexus-edges-csv",
        title: "ONEXUS Edges CSV Importer",
        register(api) {
            api.registerImporter({
                id: "onexus-edges-csv",
                label: "ONEXUS Edges CSV",
                priority: 95,
                extensions: ["csv"],
                acceptMultiple: true,

                canHandleText: async (text) => {
                    const first = String(text || "").split(/\r?\n/, 1)[0].toLowerCase();
                    return isEdgesCsvHeader(first);
                },

                importFiles: async (files) => {
                    await importEdgesCsvFiles(files);
                }
            });
        }
    });
})();