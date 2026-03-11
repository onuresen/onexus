/* =========================================================
 ONEXUS Plugin – ONEXUS Edges CSV Importer
 - Supports CSV exported by exportCSV()
 - Registers an importer via ONEXUS.registerPlugin()
 - Also exposes window.ONEXUS_EDGESCSV for legacy callers

 SET C PATCH:
 - Use ONEXUS.import.applyMeta() as single meta entry point
========================================================= */
(function () {
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
        return firstLineLower.includes("id,type,dimension,directional,source,target");
    }

    function parseEdgesCsvToGraph(csvText, { keepExistingNodes = true } = {}) {
        const lines = String(csvText ?? "").split(/\r?\n/).filter(Boolean);
        const headerLine = lines.shift() ?? "";
        const headerLower = headerLine.toLowerCase();
        if (!isEdgesCsvHeader(headerLower)) throw new Error("Not an ONEXUS edges CSV (header mismatch).");

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
                    notes: get("notes") || "",
                }
            });

            nodesSet.add(source);
            nodesSet.add(target);
        }

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
        const csvFiles = Array.from(files ?? []).filter(f => (f?.name ?? "").toLowerCase().endsWith(".csv"));
        if (!csvFiles.length) throw new Error("No CSV files provided.");

        const graphs = [];
        for (const f of csvFiles) {
            const text = await f.text();
            graphs.push(parseEdgesCsvToGraph(text, { keepExistingNodes: true }));
        }

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
                const d = e?.data ?? {};
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

        let graph = { elements: { nodes: Array.from(nodesMap.values()), edges } };

        // ✅ Set C: canonical meta
        const applyMeta = window.ONEXUS?.import?.applyMeta;
        if (typeof applyMeta === "function") {
            graph = applyMeta(graph, {
                importer: "onexus-edges-csv",
                sourceFiles: Array.from(files ?? []).map(f => f?.name).filter(Boolean),
                sourceKind: "import",
                mode: "",
            });
        } else {
            graph.meta = {
                schema: "onexus",
                importer: "onexus-edges-csv",
                importedAt: new Date().toISOString(),
                sourceFiles: Array.from(files ?? []).map(f => f?.name).filter(Boolean),
                sourceKind: "import",
            };
        }

        window.onexusLoadGraph?.(graph);
    }

    // Legacy helper
    window.ONEXUS_EDGESCSV = window.ONEXUS_EDGESCSV || {};
    window.ONEXUS_EDGESCSV.isEdgesCsvHeader = isEdgesCsvHeader;
    window.ONEXUS_EDGESCSV.parseEdgesCsvToGraph = parseEdgesCsvToGraph;
    window.ONEXUS_EDGESCSV.importFiles = importEdgesCsvFiles;
    window.ONEXUS_EDGESCSV.importText = function (csvText) {
        const graph = parseEdgesCsvToGraph(csvText, { keepExistingNodes: true });
        window.onexusLoadGraph?.(graph);
    };

    // Register plugin importer
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
                    const first = String(text ?? "").split(/\r?\n/, 1)[0].toLowerCase();
                    return isEdgesCsvHeader(first);
                },
                importFiles: async (files) => { await importEdgesCsvFiles(files); }
            });
        }
    });
})();