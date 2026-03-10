/* =====================================================
 ONEXUS Circle Chord View (D3) — view-oriented module
 - No auto-fetch
 - Accepts ONEXUS-style graph: { elements:{nodes,edges}, meta:{view:{arcOrder}}, view:{arcOrder} }
 - Preserves onexusId mapping for selection sync
 Exposes: window.ONEXUS_CIRCLE_CHART.create(svgEl, opts)
===================================================== */
(function () {
    const NS = (window.ONEXUS = window.ONEXUS || {});
    const U = NS.util || {};

    function ensureD3() {
        if (!window.d3) throw new Error("D3 is not loaded (window.d3 missing).");
        return window.d3;
    }

    function labelOfNodeData(n, lang) {
        const lbl = n?.label || {};
        const v = (lang === "jp" ? (lbl.jp || lbl.en) : (lbl.en || lbl.jp));
        return String(v || n?.name || n?.displayLabel || n?.id || "").trim() || String(n?.id || "");
    }

    function getArcOrder(graph) {
        // Priority:
        // 1) graph.view.arcOrder
        // 2) graph.meta.view.arcOrder
        // 3) graph.meta.arcOrder
        if (graph?.view && Array.isArray(graph.view.arcOrder)) return graph.view.arcOrder.slice();
        const mv = graph?.meta?.view;
        if (mv && typeof mv === "object" && Array.isArray(mv.arcOrder)) return mv.arcOrder.slice();
        if (Array.isArray(graph?.meta?.arcOrder)) return graph.meta.arcOrder.slice();
        return null;
    }

    function normalizeOnexusToChord(graph, opts = {}) {
        const lang = opts.language || "en";
        const nodeTypeAllow = opts.nodeTypeAllow || null;

        const isOnexus =
            graph &&
            graph.elements &&
            Array.isArray(graph.elements.nodes) &&
            Array.isArray(graph.elements.edges);

        if (!isOnexus) {
            throw new Error("Expected ONEXUS graph shape: {elements:{nodes,edges}, view/meta.view:{...}}");
        }

        const arcOrder = getArcOrder(graph);

        const onodes = graph.elements.nodes.map((n) => n.data || n).filter(Boolean);
        const oedges = graph.elements.edges.map((e) => e.data || e).filter(Boolean);

        // Filter node subset (only a subset for chord) — if allow set is empty, allow all
        const filteredNodes = nodeTypeAllow
            ? onodes.filter((n) => nodeTypeAllow.size === 0 || nodeTypeAllow.has(String(n.nodeType || "").trim()))
            : onodes;

        const leafByOnx = new Map();
        const onxByLeaf = new Map();

        const chordNodes = filteredNodes.map((n) => {
            const category = String(n.category || n.nodeType || "Uncategorized");
            const label = String(labelOfNodeData(n, lang)).replace(/\./g, "·");
            const leafId = `${category}.${label}`;
            leafByOnx.set(String(n.id), leafId);
            onxByLeaf.set(leafId, String(n.id));
            return { id: leafId, category, links: [], onexusId: String(n.id) };
        });

        const chordById = new Map(chordNodes.map((n) => [n.id, n]));

        const linkMeta = new Map(); // optional future use (not required by renderer)
        function normPairKey(a, b) { return a < b ? `${a}\n${b}` : `${b}\n${a}`; }
        function pushMeta(a, b, ed) {
            const k = normPairKey(a, b);
            let m = linkMeta.get(k);
            if (!m) { m = { edges: [] }; linkMeta.set(k, m); }
            m.edges.push({
                id: ed.id,
                type: ed.type,
                dimension: ed.dimension,
                phase: ed.phase,
                confidence: ed.confidence,
                directional: !!ed.directional,
                source: ed.source,
                target: ed.target,
            });
        }

        for (const e of oedges) {
            const a = leafByOnx.get(String(e.source));
            const b = leafByOnx.get(String(e.target));
            if (!a || !b || a === b) continue;

            const na = chordById.get(a);
            const nb = chordById.get(b);
            if (!na || !nb) continue;

            na.links.push(b);
            nb.links.push(a);
            pushMeta(a, b, e);
        }

        chordNodes.forEach((n) => { n.links = Array.from(new Set(n.links)); });

        return { arcOrder, nodes: chordNodes, linkMeta, leafByOnx, onxByLeaf };
    }

    function create(svgEl, opts = {}) {
        const d3 = ensureD3();

        const state = {
            svgEl,
            opts: {
                ringThickness: 22,
                linkBundleBeta: 0.94,
                fitPadding: 22,
                fitMaxScale: 1.0,
                fontLeaf: "11px Montserrat, Arial, sans-serif",
                fontCat: "600 13px Montserrat, Arial, sans-serif",
                ...opts,
            },
            width: 1000,
            height: 1000,
            chord: null,
            pinnedLeaf: null,
            svg: null,
            defs: null,
            g: null,
            linkG: null,
            nodeText: null,
            leaves: null,
            leafById: null,
            neighborMap: null,
            linkElsByLeaf: null,
            underElsByLeaf: null,
            _lastActiveTop: null,
            _lastActiveUnder: null,
            leafObjByLeafId: null,
        };

        function updateSizeFromDOM() {
            const rect = state.svgEl.getBoundingClientRect();
            state.width = Math.max(320, Math.floor(rect.width || 1000));
            state.height = Math.max(320, Math.floor(rect.height || 1000));
        }

        function measureTextPx(text, font) {
            const canvas = measureTextPx._canvas || (measureTextPx._canvas = document.createElement("canvas"));
            const ctx = canvas.getContext("2d");
            ctx.font = font;
            return ctx.measureText(text).width;
        }

        function computeAutoRadius(items) {
            const leafNames = items.map((d) => (d.id.split(".")[1] ?? d.id));
            const maxLeaf = d3.max(leafNames, (t) => measureTextPx(t, state.opts.fontLeaf)) ?? 120;
            const cats = Array.from(new Set(items.map((d) => d.category)));
            const maxCat = d3.max(cats, (t) => measureTextPx(t, state.opts.fontCat)) ?? 80;
            const labelMargin = maxLeaf + 34;
            const catMargin = maxCat * 0.25 + 20;
            const margin = Math.max(labelMargin, catMargin) + 14;
            const r = Math.min(state.width, state.height) / 2 - margin;
            return Math.max(260, Math.min(410, r));
        }

        function normalizeAngle(a) {
            const twoPi = 2 * Math.PI;
            return ((a % twoPi) + twoPi) % twoPi;
        }

        function polarPoint(r, a) {
            return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
        }

        function arcPathD(r, a0, a1) {
            const [x0, y0] = polarPoint(r, a0);
            const [x1, y1] = polarPoint(r, a1);
            const delta = a1 - a0;
            const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
            const sweep = delta >= 0 ? 1 : 0;
            return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} ${sweep} ${x1} ${y1}`;
        }

        function buildHierarchy(items, arcOrder) {
            const root = { name: "root", children: [] };
            const map = new Map();

            const categoriesPresent = Array.from(new Set(items.map((d) => d.category)));
            let orderedCats = categoriesPresent;

            if (Array.isArray(arcOrder) && arcOrder.length) {
                const set = new Set(categoriesPresent);
                const inOrder = arcOrder.filter((c) => set.has(c));
                const remaining = categoriesPresent.filter((c) => !arcOrder.includes(c));
                orderedCats = [...inOrder, ...remaining];
            }

            orderedCats.forEach((cat) => {
                const node = { name: cat, children: [] };
                map.set(cat, node);
                root.children.push(node);
            });

            items.forEach((d) => {
                if (!map.has(d.category)) {
                    const node = { name: d.category, children: [] };
                    map.set(d.category, node);
                    root.children.push(node);
                }
                map.get(d.category).children.push({ name: d.id, data: d });
            });

            return root;
        }

        function computeCategorySpans(leaves, arcOrder) {
            const byCat = d3.groups(leaves, (d) => d.parent.data.name).map(([name, nodes]) => {
                const xs = nodes.map((n) => normalizeAngle(n.x)).sort((a, b) => a - b);
                return { name, leafStart: xs[0], leafEnd: xs[xs.length - 1] };
            });

            let ordered = byCat.slice();
            if (Array.isArray(arcOrder) && arcOrder.length) {
                const map = new Map(ordered.map((d) => [d.name, d]));
                const inOrder = arcOrder.map((n) => map.get(n)).filter(Boolean);
                const remaining = ordered.filter((d) => !arcOrder.includes(d.name));
                remaining.sort((a, b) => a.leafStart - b.leafStart);
                ordered = [...inOrder, ...remaining];
            } else {
                ordered.sort((a, b) => a.leafStart - b.leafStart);
            }

            const n = ordered.length;
            const spans = [];
            for (let i = 0; i < n; i++) {
                const prev = ordered[(i - 1 + n) % n];
                const cur = ordered[i];
                const next = ordered[(i + 1) % n];

                const mid = (a, b) => {
                    const twoPi = 2 * Math.PI;
                    a = normalizeAngle(a);
                    b = normalizeAngle(b);
                    if (b < a) b += twoPi;
                    const m = a + (b - a) / 2;
                    return normalizeAngle(m);
                };

                let start = mid(prev.leafEnd, cur.leafStart);
                let end = mid(cur.leafEnd, next.leafStart);

                let startN = normalizeAngle(start);
                let endN = normalizeAngle(end);
                if (endN <= startN) endN += 2 * Math.PI;

                spans.push({ name: cur.name, startAngle: startN, endAngle: endN });
            }

            return spans;
        }

        function clearTouchedActive() {
            if (state._lastActiveTop) state._lastActiveTop.forEach((el) => el.classList.remove("active"));
            if (state._lastActiveUnder) state._lastActiveUnder.forEach((el) => el.classList.remove("active"));
            state._lastActiveTop = null;
            state._lastActiveUnder = null;
        }

        function applyHighlight(leafNode) {
            if (!leafNode) return;
            const neighbors = state.neighborMap.get(leafNode) || new Set();

            state.nodeText
                .classed("active", (d) => d === leafNode)
                .classed("connected", (d) => neighbors.has(d));

            state.linkG.classed("has-focus", true);

            clearTouchedActive();

            const topSet = state.linkElsByLeaf.get(leafNode) || new Set();
            const underSet = state.underElsByLeaf.get(leafNode) || new Set();
            topSet.forEach((el) => el.classList.add("active"));
            underSet.forEach((el) => el.classList.add("active"));
            state._lastActiveTop = topSet;
            state._lastActiveUnder = underSet;
        }

        function resetHighlight() {
            if (!state.nodeText || !state.linkG) return;
            state.nodeText.classed("active", false).classed("connected", false);
            state.linkG.classed("has-focus", false);
            clearTouchedActive();
        }

        function render() {
            const d3 = ensureD3();
            updateSizeFromDOM();

            const chord = state.chord;
            const items = chord?.nodes || [];
            const arcOrder = chord?.arcOrder || null;

            state.svg = d3.select(state.svgEl);
            state.svg.selectAll("*").remove();
            state.svg.attr("viewBox", [-state.width / 2, -state.height / 2, state.width, state.height]);

            state.defs = state.svg.append("defs");
            state.g = state.svg.append("g");

            state.svg.on("click", () => {
                state.pinnedLeaf = null;
                resetHighlight();
                try { state.opts.onPinChanged?.(null); } catch { }
            });

            if (!items.length) return;

            const RADIUS = computeAutoRadius(items);
            const OUTER_ARC_RADIUS = RADIUS;
            const INNER_ARC_RADIUS = RADIUS - state.opts.ringThickness;
            const LINK_RADIUS = RADIUS - 10;
            const RING_TEXT_RADIUS = INNER_ARC_RADIUS + state.opts.ringThickness * 0.5;
            const LABEL_RADIUS = RADIUS + 2;
            const LABEL_OFFSET = 5;
            const SEPARATOR_INSET = 0.5;

            const cluster = d3.cluster().size([2 * Math.PI, LINK_RADIUS]);
            const root = d3.hierarchy(buildHierarchy(items, arcOrder));
            cluster(root);

            root.children.forEach((group) => {
                group.leaves().forEach((d) => { d.x = group.x + (d.x - group.x) * 0.86; });
            });

            state.leaves = root.leaves();
            state.leafById = new Map(state.leaves.map((d) => [d.data.name, d]));
            state.leafObjByLeafId = new Map(items.map((x) => [x.id, x]));

            const line = d3.lineRadial()
                .curve(d3.curveBundle.beta(state.opts.linkBundleBeta))
                .radius((d) => d.y)
                .angle((d) => d.x);

            const links = [];
            state.leaves.forEach((source) => {
                const src = source.data.data;
                if (!src || !Array.isArray(src.links)) return;
                src.links.forEach((targetId) => {
                    const target = state.leafById.get(targetId);
                    if (!target) return;
                    links.push({ source, target, path: source.path(target) });
                });
            });

            state.neighborMap = new Map();
            function addNeighbor(a, b) {
                let s = state.neighborMap.get(a);
                if (!s) { s = new Set(); state.neighborMap.set(a, s); }
                s.add(b);
            }
            links.forEach((l) => { addNeighbor(l.source, l.target); addNeighbor(l.target, l.source); });

            state.linkG = state.g.append("g").attr("class", "links");

            const linkUnderSel = state.linkG.selectAll("path.link-under")
                .data(links)
                .join("path")
                .attr("class", "link-under")
                .attr("d", (d) => line(d.path));

            const linkSel = state.linkG.selectAll("path.link")
                .data(links)
                .join("path")
                .attr("class", "link")
                .attr("d", (d) => line(d.path));

            state.linkElsByLeaf = new Map();
            state.underElsByLeaf = new Map();

            function addToMap(map, node, el) {
                let set = map.get(node);
                if (!set) { set = new Set(); map.set(node, set); }
                set.add(el);
            }

            linkSel.each(function (d) {
                addToMap(state.linkElsByLeaf, d.source, this);
                addToMap(state.linkElsByLeaf, d.target, this);
            });

            linkUnderSel.each(function (d) {
                addToMap(state.underElsByLeaf, d.source, this);
                addToMap(state.underElsByLeaf, d.target, this);
            });

            const ringArc = d3.arc()
                .innerRadius(INNER_ARC_RADIUS)
                .outerRadius(OUTER_ARC_RADIUS)
                .startAngle(0)
                .endAngle(2 * Math.PI);

            state.g.append("path").attr("class", "ring").attr("d", ringArc());

            const categories = computeCategorySpans(state.leaves, arcOrder);
            const sepAngles = categories.map((d) => d.startAngle);

            state.g.append("g")
                .selectAll("line.separator")
                .data(sepAngles)
                .join("line")
                .attr("class", "separator")
                .attr("x1", (a) => polarPoint(INNER_ARC_RADIUS + SEPARATOR_INSET, a)[0])
                .attr("y1", (a) => polarPoint(INNER_ARC_RADIUS + SEPARATOR_INSET, a)[1])
                .attr("x2", (a) => polarPoint(OUTER_ARC_RADIUS - SEPARATOR_INSET, a)[0])
                .attr("y2", (a) => polarPoint(OUTER_ARC_RADIUS - SEPARATOR_INSET, a)[1]);

            const labelPad = 0.022;
            const catBaseFont = 13;

            state.defs.selectAll("path.arc-label-path")
                .data(categories)
                .join("path")
                .attr("class", "arc-label-path")
                .attr("id", (_, i) => `arc-label-${i}`)
                .attr("d", (d) => {
                    const a0 = d.startAngle + labelPad;
                    const a1 = d.endAngle - labelPad;
                    const midN = normalizeAngle((a0 + a1) / 2);
                    const bottomHalf = midN > Math.PI / 2 && midN < 3 * Math.PI / 2;
                    d.bottomHalf = bottomHalf;
                    return bottomHalf ? arcPathD(RING_TEXT_RADIUS, a1, a0) : arcPathD(RING_TEXT_RADIUS, a0, a1);
                });

            state.g.append("g")
                .selectAll("text.arc-label")
                .data(categories)
                .join("text")
                .attr("class", "arc-label")
                .attr("dominant-baseline", "middle")
                .attr("dy", "0")
                .each(function (d, i) {
                    const a0 = d.startAngle + labelPad;
                    const a1 = d.endAngle - labelPad;
                    const span = Math.max(0.0001, Math.abs(a1 - a0));
                    const available = RING_TEXT_RADIUS * span * 0.92;
                    const textWidth = measureTextPx(d.name, state.opts.fontCat);
                    const shrink = Math.min(1, available / Math.max(1, textWidth));
                    const fontSize = Math.max(10, Math.round(catBaseFont * shrink));
                    const startOffset = d.bottomHalf ? "94%" : "6%";
                    const anchor = d.bottomHalf ? "end" : "start";

                    const t = d3.select(this).attr("font-size", fontSize).attr("text-anchor", anchor);
                    t.append("textPath")
                        .attr("href", `#arc-label-${i}`)
                        .attr("startOffset", startOffset)
                        .text(d.name);
                });

            const nodeSel = state.g.append("g")
                .selectAll(".node")
                .data(state.leaves)
                .join("g")
                .attr("transform", (d) => {
                    const a = (d.x * 180) / Math.PI - 90;
                    return `rotate(${a}) translate(${LABEL_RADIUS},0)`;
                });

            state.nodeText = nodeSel.append("text")
                .attr("class", "node-label")
                .attr("dy", "0.32em")
                .attr("x", (d) => (d.x < Math.PI ? LABEL_OFFSET : -LABEL_OFFSET))
                .attr("text-anchor", (d) => (d.x < Math.PI ? "start" : "end"))
                .attr("transform", (d) => (d.x >= Math.PI ? "rotate(180)" : null))
                .text((d) => (d.data.name.split(".")[1] ?? d.data.name))
                .on("mouseenter", (_, d) => { if (!state.pinnedLeaf) applyHighlight(d); })
                .on("mouseleave", () => { if (!state.pinnedLeaf) resetHighlight(); })
                .on("click", (event, d) => {
                    event.stopPropagation();
                    if (state.pinnedLeaf === d) {
                        state.pinnedLeaf = null;
                        resetHighlight();
                        try { state.opts.onPinChanged?.(null); } catch { }
                    } else {
                        state.pinnedLeaf = d;
                        applyHighlight(d);
                        const leafId = d?.data?.name;
                        const leafObj = state.leafObjByLeafId.get(leafId);
                        try { state.opts.onPinChanged?.(leafObj?.onexusId ?? null); } catch { }
                    }
                });

            requestAnimationFrame(() => {
                const bbox = state.g.node().getBBox();
                if (!bbox || !isFinite(bbox.width) || !isFinite(bbox.height)) return;
                const availW = state.width - state.opts.fitPadding * 2;
                const availH = state.height - state.opts.fitPadding * 2;
                const scale = Math.min(state.opts.fitMaxScale, availW / bbox.width, availH / bbox.height);
                const cx = bbox.x + bbox.width / 2;
                const cy = bbox.y + bbox.height / 2;
                state.g.attr("transform", `translate(${-cx * scale},${-cy * scale}) scale(${scale})`);
            });

            if (state.pinnedLeaf) applyHighlight(state.pinnedLeaf);
        }

        function setGraph(onexusGraph, setOpts = {}) {
            const lang = setOpts.language || state.opts.language || "en";
            const allow = setOpts.nodeTypeAllow || state.opts.nodeTypeAllow || null;
            const allowSet = Array.isArray(allow) ? new Set(allow.map(String)) : (allow instanceof Set ? allow : null);

            state.chord = normalizeOnexusToChord(onexusGraph, { language: lang, nodeTypeAllow: allowSet });

            if (state.pinnedLeaf && state.chord && state.chord.onxByLeaf) {
                const leafId = state.pinnedLeaf?.data?.name;
                if (leafId && !state.chord.onxByLeaf?.has(leafId)) state.pinnedLeaf = null;
            }

            render();
        }

        function setPinnedOnexusId(onexusId) {
            if (!state.chord || !state.leafById) return;
            if (!onexusId) { state.pinnedLeaf = null; resetHighlight(); return; }

            const leafId = state.chord.leafByOnx.get(String(onexusId));
            if (!leafId) return;
            const leaf = state.leafById.get(leafId);
            if (!leaf) return;

            state.pinnedLeaf = leaf;
            applyHighlight(leaf);
        }

        function destroy() {
            try {
                const d3 = ensureD3();
                d3.select(state.svgEl).on("click", null);
                d3.select(state.svgEl).selectAll("*").remove();
            } catch { }
            state.svg = state.defs = state.g = state.linkG = state.nodeText = null;
            state.leaves = state.leafById = null;
            state.neighborMap = null;
            state.linkElsByLeaf = state.underElsByLeaf = null;
            state._lastActiveTop = state._lastActiveUnder = null;
            state.chord = null;
            state.pinnedLeaf = null;
        }

        return { setGraph, setPinnedOnexusId, destroy };
    }

    window.ONEXUS_CIRCLE_CHART = { create };
})();