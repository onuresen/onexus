/* =========================================================
ONEXUS – Dependency Graph Builder (Files ↔ Globals ↔ DOM)
- Safe: reads scripts via fetch (same-origin only), no mutation of main cy
- Output: ONEXUS graph JSON (elements.nodes/edges)
- Live view: separate Cytoscape instance in overlay
Exports:
  window.ONEXUS_DEPGRAPH.build()
  window.ONEXUS_DEPGRAPH.show()
  window.ONEXUS_DEPGRAPH.exportJSON()
  window.ONEXUS_DEPGRAPH.getGraph()
  window.ONEXUS_DEPGRAPH.lastGraph
========================================================= */
(function () {
    const DEV_NS = (window.ONEXUS_DEPGRAPH = window.ONEXUS_DEPGRAPH || {});
    const NOW = () => new Date().toISOString();

    function isSameOrigin(urlStr) {
        try {
            const u = new URL(urlStr, location.href);
            return u.origin === location.origin;
        } catch {
            return false;
        }
    }

    function listScriptSrcs() {
        const out = [];
        for (const s of Array.from(document.scripts || [])) {
            const src = (s.getAttribute("src") || "").trim();
            if (src) out.push(src);
        }
        return out;
    }

    function normalizeSrc(src) {
        try {
            return new URL(src, location.href).href;
        } catch {
            return src;
        }
    }

    // --------- lightweight parsing (regex; best-effort) ---------
    function parseExports(text) {
        const exports = new Set();

        // window.FOO =
        {
            const re = /window\.(\w[\w$]*)\s*=/g;
            let m;
            while ((m = re.exec(text))) exports.add(`window.${m[1]}`);
        }

        // window.ONEXUS_FOO =
        {
            const re = /window\.(ONEXUS_\w[\w$]*)\s*=/g;
            let m;
            while ((m = re.exec(text))) exports.add(`window.${m[1]}`);
        }

        // window.ONEXUS.ui.positionPopover =
        {
            const re = /window\.ONEXUS(?:\.\w[\w$]*)+\s*=/g;
            let m;
            while ((m = re.exec(text))) exports.add(m[0].replace(/\s*=/, ""));
        }

        return Array.from(exports);
    }

    function parseUses(text) {
        const uses = new Set();

        // window.FOO
        {
            const re = /window\.(\w[\w$]*)/g;
            let m;
            while ((m = re.exec(text))) uses.add(`window.${m[1]}`);
        }

        // window.ONEXUS.xxx.yyy
        {
            const re = /window\.ONEXUS(?:\.\w[\w$]*)+/g;
            let m;
            while ((m = re.exec(text))) uses.add(m[0]);
        }

        // ONEXUS_FOO bare
        {
            const re = /\b(ONEXUS_\w[\w$]*)\b/g;
            let m;
            while ((m = re.exec(text))) uses.add(`window.${m[1]}`);
        }

        return Array.from(uses);
    }

    function parseDomIds(text) {
        const ids = new Set();
        const re = /getElementById\(\s*["'`](.+?)["'`]\s*\)/g;
        let m;
        while ((m = re.exec(text))) ids.add(m[1]);
        return Array.from(ids);
    }

    // --------- graph assembly (ONEXUS schema via common) ---------
    async function buildOnexusDepGraph({ includeDom = true, includeSymbols = true } = {}) {
        const DG = window.ONEXUS_DEVGRAPH;
        if (!DG?.makeGraph) throw new Error("ONEXUS_DEVGRAPH missing. Load onexus-devgraph.common.js first.");

        const graph = DG.makeGraph({
            kind: "onexus/depgraph",
            source: location.href,
            note: "Best-effort dependency graph (regex parsing).",
            builtAt: NOW(),
        });

        const scriptSrcs = listScriptSrcs().map(normalizeSrc);
        const sameOrigin = scriptSrcs.filter(isSameOrigin);

        const fileIdOf = (href) => `FILE_${DG.idSafe(href.split("/").slice(-1)[0] || href)}`;
        const fileLabelOf = (href) => href.split("/").slice(-1)[0] || href;

        const allFiles = scriptSrcs.map((href) => ({
            href,
            id: fileIdOf(href),
            label: fileLabelOf(href),
            sameOrigin: isSameOrigin(href),
        }));

        const fileExports = new Map();
        const fileUses = new Map();
        const fileDom = new Map();

        await Promise.all(
            sameOrigin.map(async (href) => {
                const fid = fileIdOf(href);
                try {
                    const res = await fetch(href, { cache: "no-store" });
                    const text = await res.text();
                    fileExports.set(fid, parseExports(text));
                    fileUses.set(fid, parseUses(text));
                    fileDom.set(fid, parseDomIds(text));
                } catch {
                    fileExports.set(fid, []);
                    fileUses.set(fid, []);
                    fileDom.set(fid, []);
                }
            })
        );

        // Index exporters: sym -> fileIds
        const exportIndex = new Map();
        for (const f of allFiles) {
            const ex = fileExports.get(f.id) || [];
            ex.forEach((sym) => {
                const list = exportIndex.get(sym) || [];
                list.push(f.id);
                exportIndex.set(sym, list);
            });
        }

        const symNodeId = (sym) => `SYM_${DG.idSafe(sym)}`;
        const domNodeId = (domId) => `DOM_${DG.idSafe(domId)}`;

        // Nodes: files
        for (const f of allFiles) {
            DG.addNode(graph, {
                id: f.id,
                nodeType: "File",
                category: "Module",
                label: f.label,
                data: { href: f.href, sameOrigin: !!f.sameOrigin },
            });
        }

        // Symbols & dependency edges
        if (includeSymbols) {
            // Exports
            for (const f of allFiles) {
                const ex = fileExports.get(f.id) || [];
                for (const sym of ex) {
                    const sid = symNodeId(sym);
                    DG.addNode(graph, { id: sid, nodeType: "Symbol", category: "Export", label: sym });
                    DG.addEdge(graph, {
                        id: `E_${DG.idSafe(f.id)}_Exports_${DG.idSafe(sid)}`,
                        type: "Exports",
                        dimension: "System",
                        source: f.id,
                        target: sid,
                        directional: true,
                    });
                }
            }

            // Uses & DependsOn
            for (const f of allFiles) {
                const uses = fileUses.get(f.id) || [];
                const deps = new Set();
                for (const sym of uses) {
                    const sid = symNodeId(sym);
                    DG.addNode(graph, { id: sid, nodeType: "Symbol", category: "Export", label: sym });

                    DG.addEdge(graph, {
                        type: "Uses",
                        dimension: "System",
                        source: f.id,
                        target: sid,
                        directional: true,
                    });

                    (exportIndex.get(sym) || []).forEach((ef) => {
                        if (ef !== f.id) deps.add(ef);
                    });
                }

                for (const depFileId of deps) {
                    DG.addEdge(graph, {
                        id: `E_${DG.idSafe(f.id)}_DependsOn_${DG.idSafe(depFileId)}`,
                        type: "DependsOn",
                        dimension: "System",
                        source: f.id,
                        target: depFileId,
                        directional: true,
                    });
                }
            }
        }

        // DOM anchors
        if (includeDom) {
            for (const f of allFiles) {
                const ids = fileDom.get(f.id) || [];
                for (const did of ids) {
                    const dnid = domNodeId(did);
                    DG.addNode(graph, { id: dnid, nodeType: "DOM", category: "Anchor", label: `#${did}` });
                    DG.addEdge(graph, {
                        type: "RequiresDOM",
                        dimension: "Spatial",
                        source: f.id,
                        target: dnid,
                        directional: true,
                    });
                }
            }
        }

        graph.meta.files = { total: allFiles.length, sameOrigin: sameOrigin.length };
        return DG.ensureGraph(graph, { autoCreateEndpointNodes: true });
    }

    // --------- Live overlay viewer (separate Cytoscape instance) ---------
    function ensureOverlay() {
        let host = document.getElementById("onx-depgraph-overlay");
        if (host) return host;

        host = document.createElement("div");
        host.id = "onx-depgraph-overlay";
        Object.assign(host.style, {
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,.45)",
            zIndex: "10100",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
        });

        const panel = document.createElement("div");
        panel.id = "onx-depgraph-panel";
        Object.assign(panel.style, {
            width: "min(1180px, calc(100vw - 40px))",
            height: "min(760px, calc(100vh - 40px))",
            background: "var(--bg-panel, #fff)",
            borderRadius: "12px",
            border: "1px solid rgba(0,0,0,0.12)",
            boxShadow: "0 18px 44px rgba(0,0,0,0.28)",
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "44px 1fr",
        });

        const head = document.createElement("div");
        Object.assign(head.style, {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "0 12px",
            borderBottom: "1px solid var(--stroke, #e5e7eb)",
            background: "rgba(255,255,255,0.65)",
            backdropFilter: "blur(8px)",
        });

        head.innerHTML = `
      <div style="font-weight:900;font-size:12px;letter-spacing:.02em;">ONEXUS Dependency Graph</div>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <button id="onx-depgraph-rebuild"
          style="padding:6px 10px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          Rebuild
        </button>
        <button id="onx-depgraph-export"
          style="padding:6px 10px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          Export JSON
        </button>
        <button id="onx-depgraph-close"
          style="padding:6px 10px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          Close
        </button>
      </div>
    `;

        const body = document.createElement("div");
        body.id = "onx-depgraph-cy";
        Object.assign(body.style, { position: "relative" });

        panel.appendChild(head);
        panel.appendChild(body);
        host.appendChild(panel);
        document.body.appendChild(host);

        // close handlers
        host.addEventListener("click", (e) => {
            if (e.target === host) hideOverlay();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && host.style.display !== "none") hideOverlay();
        });

        return host;
    }

    function showOverlay() {
        const host = ensureOverlay();
        host.style.display = "flex";
    }

    function hideOverlay() {
        const host = document.getElementById("onx-depgraph-overlay");
        if (host) host.style.display = "none";
    }

    function buildCytoscapeStyle() {
        // Keep labels INSIDE nodes like ONEXUS main style
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const labelLen = (n) => String(n.data("displayLabel") ?? "").length;

        // Dynamic sizing: slightly grow nodes for long labels, but cap them
        const nodeW = (n, base) => clamp(base + Math.floor(labelLen(n) / 12) * 10, base, base + 80);
        const nodeH = (n, base) => clamp(base + Math.floor(labelLen(n) / 18) * 8, base, base + 60);

        return [
            {
                selector: "node",
                style: {
                    "label": "data(displayLabel)",

                    // ✅ Inside alignment
                    "text-valign": "center",
                    "text-halign": "center",
                    "text-justification": "center",

                    // ✅ Wrap inside node
                    "text-wrap": "wrap",
                    "text-max-width": (n) => {
                        const t = n.data("nodeType");
                        const base = (t === "File") ? 120 : (t === "DOM" ? 95 : 110);
                        // keep width aligned with node size
                        return `${nodeW(n, base) - 16}px`;
                    },

                    // ✅ Readable like main graph (no background pill outside)
                    "font-size": (n) => {
                        // slightly smaller for long labels
                        const L = labelLen(n);
                        return (L > 48) ? 8 : (L > 24 ? 9 : 10);
                    },
                    "font-weight": 800,
                    "color": "#111827",
                    "text-outline-width": 2,
                    "text-outline-color": "#ffffff",

                    // Node fill by type
                    "background-color": (n) => {
                        const t = n.data("nodeType");
                        if (t === "File") return "#2563eb";
                        if (t === "Symbol") return "#10b981";
                        if (t === "DOM") return "#f59e0b";
                        return "#64748b";
                    },

                    // ✅ Give node enough room for wrapped text
                    "width": (n) => {
                        const t = n.data("nodeType");
                        const base = (t === "File") ? 130 : (t === "DOM" ? 105 : 120);
                        return nodeW(n, base);
                    },
                    "height": (n) => {
                        const t = n.data("nodeType");
                        const base = (t === "File") ? 70 : (t === "DOM" ? 62 : 68);
                        return nodeH(n, base);
                    },

                    // Shapes (keep your semantics)
                    "shape": (n) => {
                        const t = n.data("nodeType");
                        if (t === "File") return "round-rectangle";
                        if (t === "Symbol") return "ellipse";
                        if (t === "DOM") return "diamond";
                        return "ellipse";
                    },

                    // subtle border for contrast
                    "border-width": 1,
                    "border-color": "rgba(0,0,0,0.15)",
                },
            },
            {
                selector: "edge",
                style: {
                    "curve-style": "bezier",
                    "target-arrow-shape": "triangle",
                    "arrow-scale": 0.9,

                    "line-color": (e) => {
                        const t = e.data("type");
                        if (t === "Exports") return "#0ea5e9";
                        if (t === "Uses") return "#22c55e";
                        if (t === "DependsOn") return "#a855f7";
                        if (t === "RequiresDOM") return "#f59e0b";
                        return "#94a3b8";
                    },
                    "target-arrow-color": (e) => e.style("line-color"),
                    "width": (e) => (e.data("type") === "DependsOn" ? 3.0 : 2.2),
                    "opacity": 0.9,

                    // Edge labels can stay on edges (fine)
                    "label": "data(type)",
                    "font-size": 8,
                    "text-background-color": "#ffffff",
                    "text-background-opacity": 0.85,
                    "text-background-padding": 2,
                    "text-rotation": "autorotate",
                    "text-outline-width": 1,
                    "text-outline-color": "#ffffff",
                    "color": "#111827",
                },
            },
        ];
    }

    async function renderIntoOverlay(graph) {
        const DG = window.ONEXUS_DEVGRAPH;
        const host = ensureOverlay();
        const container = document.getElementById("onx-depgraph-cy");
        if (!container) return;

        const g = DG.ensureGraph(graph, { autoCreateEndpointNodes: true });

        // Convert ONEXUS graph to Cytoscape elements
        const els = [];
        (g.elements?.nodes || []).forEach((n) => els.push({ data: { ...n.data } }));
        (g.elements?.edges || []).forEach((e) => els.push({ data: { ...e.data } }));

        // destroy previous instance if any
        if (host.___depCy && host.___depCy.destroy) {
            try { host.___depCy.destroy(); } catch { }
            host.___depCy = null;
        }

        const cy2 = cytoscape({
            container,
            elements: els,
            style: buildCytoscapeStyle(),
            layout: { name: "cose", animate: true, padding: 30 },
            wheelSensitivity: 0.2,
            minZoom: 0.2,
            maxZoom: 3,
        });

        host.___depCy = cy2;

        cy2.on("tap", "node", (evt) => console.debug("[DEPGRAPH] node:", evt.target.data()));
        cy2.on("tap", "edge", (evt) => console.debug("[DEPGRAPH] edge:", evt.target.data()));
        setTimeout(() => { try { cy2.fit(undefined, 50); } catch { } }, 50);
    }

    // --------- Public API ---------
    DEV_NS.lastGraph = null;

    DEV_NS.getGraph = function getGraph() {
        return DEV_NS.lastGraph;
    };

    DEV_NS.build = async function build(opts = {}) {
        const g = await buildOnexusDepGraph(opts);
        DEV_NS.lastGraph = g;
        return g;
    };

    DEV_NS.exportJSON = async function exportJSON(opts = {}) {
        const DG = window.ONEXUS_DEVGRAPH;
        const g = await DEV_NS.build(opts);
        const name = `onexus-depgraph_graph_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        DG.downloadGraph(g, name);
        return g;
    };

    DEV_NS.show = async function show(opts = {}) {
        showOverlay();
        const g = await DEV_NS.build(opts);
        await renderIntoOverlay(g);

        const btnClose = document.getElementById("onx-depgraph-close");
        const btnExport = document.getElementById("onx-depgraph-export");
        const btnRebuild = document.getElementById("onx-depgraph-rebuild");

        if (btnClose && !btnClose.___hooked) {
            btnClose.___hooked = true;
            btnClose.addEventListener("click", hideOverlay);
        }
        if (btnExport && !btnExport.___hooked) {
            btnExport.___hooked = true;
            btnExport.addEventListener("click", () => DEV_NS.exportJSON(opts));
        }
        if (btnRebuild && !btnRebuild.___hooked) {
            btnRebuild.___hooked = true;
            btnRebuild.addEventListener("click", async () => {
                const g2 = await DEV_NS.build(opts);
                await renderIntoOverlay(g2);
            });
        }

        return g;
    };

    // Optional: hotkey Shift+G (dev)
    function hookHotkey() {
        if (document.___onxDepgraphHotkey) return;
        document.___onxDepgraphHotkey = true;

        document.addEventListener("keydown", (e) => {
            const tag = (e.target?.tagName || "").toUpperCase();
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

            if (e.shiftKey && String(e.key || "").toLowerCase() === "g") {
                e.preventDefault();
                DEV_NS.show({ includeDom: true, includeSymbols: true });
            }
        });
    }

    setTimeout(() => hookHotkey(), 120);
})();