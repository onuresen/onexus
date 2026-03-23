/* =====================================================
 ONEXUS Sankey Chart (D3 + d3-sankey)
 - Exposes: window.ONEXUS_SANKEY_CHART.create(svgEl, opts)
 - Input: { nodes:[{id}], links:[{source,target,value,nodeIds,edgeIds}], meta:{} }
 - Emits pick callback: opts.onPick({nodeIds, edgeIds})
===================================================== */
(function () {
    function ensureD3() {
        if (!window.d3) throw new Error("D3 not loaded (window.d3 missing).");

        // d3-sankey UMD commonly registers onto d3 (d3.sankey, d3.sankeyLinkHorizontal)
        const hasD3SankeyOnD3 =
            typeof window.d3.sankey === "function" &&
            typeof window.d3.sankeyLinkHorizontal === "function";

        // Some builds expose a separate global (rare) — support it too
        const hasGlobal =
            window.d3Sankey &&
            typeof window.d3Sankey.sankey === "function" &&
            typeof window.d3Sankey.sankeyLinkHorizontal === "function";

        if (!hasD3SankeyOnD3 && !hasGlobal) {
            throw new Error("d3-sankey not loaded (expected d3.sankey or window.d3Sankey).");
        }

        // Normalize to one interface used below
        const d3Sankey = hasD3SankeyOnD3
            ? { sankey: window.d3.sankey, sankeyLinkHorizontal: window.d3.sankeyLinkHorizontal }
            : window.d3Sankey;

        return { d3: window.d3, d3Sankey };
    }

    function create(svgEl, opts = {}) {
        const { d3, d3Sankey } = ensureD3();

        const state = {
            svgEl,
            opts: {
                nodeWidth: 18,
                nodePadding: 12,
                linkOpacity: 0.35,
                linkOpacityHover: 0.75,
                nodeOpacity: 0.92,
                font: "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                colorNode: (id) => {
                    // stable color hash
                    let h = 2166136261;
                    const s = String(id ?? "");
                    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
                    const c = (h >>> 0) % 10;
                    const pal = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#64748B"];
                    return pal[c];
                },
                onPick: typeof opts.onPick === "function" ? opts.onPick : null,
                ...opts
            },
            data: { nodes: [], links: [], meta: {} },
            w: 800,
            h: 600,
            svg: null,
            g: null,
            sankey: null,
            layout: null,
            rendered: false
        };

        function sizeFromDOM() {
            const r = state.svgEl.getBoundingClientRect();
            state.w = Math.max(520, Math.floor(r.width || 800));
            state.h = Math.max(420, Math.floor(r.height || 600));
        }

        function clear() {
            const s = d3.select(state.svgEl);
            s.selectAll("*").remove();
        }

        function requestRender() {
            // lightweight: re-render everything (MVP)
            render();
        }

        function normalizeToSankeyGraph(input) {
            const nodesIn = Array.isArray(input?.nodes) ? input.nodes : [];
            const linksIn = Array.isArray(input?.links) ? input.links : [];

            const idToIndex = new Map();
            const nodes = nodesIn.map((n, i) => {
                const id = String(n.id ?? "");
                idToIndex.set(id, i);

                const name = id.startsWith("L1:") || id.startsWith("L2:") || id.startsWith("L3:")
                    ? id.slice(3)
                    : id;
                return { id, name };
            });

            const links = [];
            for (const l of linksIn) {
                const s = String(l.source ?? "");
                const t = String(l.target ?? "");
                if (!idToIndex.has(s) || !idToIndex.has(t) || s === t) continue;
                links.push({
                    source: idToIndex.get(s),
                    target: idToIndex.get(t),
                    value: Math.max(0.0001, Number(l.value ?? 1)),
                    _src: s,
                    _tgt: t,
                    nodeIds: Array.isArray(l.nodeIds) ? l.nodeIds : [],
                    edgeIds: Array.isArray(l.edgeIds) ? l.edgeIds : []
                });
            }
            return { nodes, links };
        }

        function render() {
            sizeFromDOM();
            clear();

            const { nodes, links } = normalizeToSankeyGraph(state.data);

            const svg = d3.select(state.svgEl)
                .attr("width", state.w)
                .attr("height", state.h)
                .attr("viewBox", `0 0 ${state.w} ${state.h}`)
                .style("display", "block");

            state.svg = svg;
            const g = svg.append("g").attr("class", "onx-sankey-root");
            state.g = g;

            // Layout
            const sankey = d3Sankey.sankey()
                .nodeWidth(state.opts.nodeWidth)
                .nodePadding(state.opts.nodePadding)
                .extent([[16, 54], [state.w - 16, state.h - 18]]);

            const graph = sankey({
                nodes: nodes.map(d => Object.assign({}, d)),
                links: links.map(d => Object.assign({}, d))
            });

            // Links
            const link = g.append("g")
                .attr("class", "onx-sankey-links")
                .selectAll("path")
                .data(graph.links)
                .join("path")
                .attr("class", "onx-sankey-link")
                .attr("d", d3Sankey.sankeyLinkHorizontal())
                .attr("stroke", (d) => state.opts.colorNode(d._src))
                .attr("stroke-width", (d) => Math.max(1, d.width))
                .attr("stroke-opacity", state.opts.linkOpacity)
                .on("mouseenter", function () {
                    d3.select(this).attr("stroke-opacity", state.opts.linkOpacityHover);
                })
                .on("mouseleave", function () {
                    d3.select(this).attr("stroke-opacity", state.opts.linkOpacity);
                })
                .on("click", (evt, d) => {
                    evt.stopPropagation();
                    state.opts.onPick?.({ nodeIds: d.nodeIds, edgeIds: d.edgeIds });
                });

            // Nodes
            const node = g.append("g")
                .attr("class", "onx-sankey-nodes")
                .selectAll("g")
                .data(graph.nodes)
                .join("g")
                .attr("class", "onx-sankey-node")
                .on("click", (evt, d) => {
                    evt.stopPropagation();
                    // node click: pick all links touching this node
                    const edgeIds = [];
                    const nodeIds = [];
                    graph.links.forEach(L => {
                        if (L.source.index === d.index || L.target.index === d.index) {
                            (L.edgeIds || []).forEach(x => edgeIds.push(x));
                            (L.nodeIds || []).forEach(x => nodeIds.push(x));
                        }
                    });
                    state.opts.onPick?.({ nodeIds: Array.from(new Set(nodeIds)), edgeIds: Array.from(new Set(edgeIds)) });
                });

            node.append("rect")
                .attr("x", d => d.x0)
                .attr("y", d => d.y0)
                .attr("height", d => Math.max(2, d.y1 - d.y0))
                .attr("width", d => Math.max(2, d.x1 - d.x0))
                .attr("fill", d => state.opts.colorNode(d.id))
                .attr("fill-opacity", state.opts.nodeOpacity);

            node.append("text")
                .attr("x", d => (d.x0 < state.w / 2) ? (d.x1 + 8) : (d.x0 - 8))
                .attr("y", d => (d.y0 + d.y1) / 2)
                .attr("text-anchor", d => (d.x0 < state.w / 2) ? "start" : "end")
                .attr("dominant-baseline", "middle")
                .attr("class", "onx-sankey-label")
                .style("font", state.opts.font)
                .text(d => d.name);

            // Title / click background
            svg.on("click", () => {
                state.opts.onPick?.({ nodeIds: [], edgeIds: [] });
            });

            state.rendered = true;
        }

        function setData(data) {
            state.data = data || { nodes: [], links: [], meta: {} };
            render();
        }

        return { setData, requestRender };
    }

    window.ONEXUS_SANKEY_CHART = { create };
})();