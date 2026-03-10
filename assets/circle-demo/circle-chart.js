/* =====================================================
 Circular edge-bundling — visual parity pass
 - Loads data from data.json
 - Continuous ring (never gaps) + separators
 - Tangential tight labels with auto-fit scaling
 - Ring text: upright everywhere + stable spans (fixes overlap / empty wedge)
===================================================== */

// Responsive sizing: derived from the SVG's rendered size
let WIDTH = 1000;
let HEIGHT = 1000;

function updateSizeFromDOM() {
    const svgEl = document.getElementById("chart");
    const rect = svgEl.getBoundingClientRect();
    // fallback if invisible / not laid out yet
    const w = Math.max(320, Math.floor(rect.width || 1000));
    const h = Math.max(320, Math.floor(rect.height || 1000));
    WIDTH = w;
    HEIGHT = h;
}
const DATA_URL = "data.onexus.json";

/* ---- visual tuning knobs (safe to tweak) ---- */
const RING_THICKNESS = 22;
const LINK_BUNDLE_BETA = 0.94;
const LABEL_FONT = '11px Montserrat, Arial, sans-serif';
const CAT_FONT = '600 13px Montserrat, Arial, sans-serif';
const FIT_PADDING = 22;
const FIT_MAX_SCALE = 1.0;

/* =====================================================
 Load + Init
===================================================== */
d3.json(DATA_URL).then(raw => {
    const normalized = normalizeData(raw);
    const enriched = addDeterministicLinks(normalized.nodes);
    render({
        nodes: enriched,
        arcOrder: normalized.arcOrder
    });
}).catch(err => {
    console.error("Failed to load data.json. Run via a local server (Live Server).", err);
});

/* =====================================================
 Data helpers
===================================================== */
function normalizeDataOld(raw) {
    // Accept either:
    // 1) array of {id, category, links}
    // 2) object { nodes: [...], arcOrder: [...] }
    const nodes = Array.isArray(raw) ? raw : (raw && raw.nodes ? raw.nodes : []);
    const arcOrder = (!Array.isArray(raw) && raw && Array.isArray(raw.arcOrder)) ? raw.arcOrder.slice() : null;

    return {
        arcOrder,
        nodes: nodes.map(d => ({
            id: d.id,
            category: d.category,
            links: Array.isArray(d.links) ? d.links.slice() : []
        }))
    };
}

function normalizeData(raw) {
    // Supports:
    // A) chord format: array of {id, category, links} OR {nodes:[...], arcOrder:[...]}
    // B) ONEXUS-ish format: { view:{arcOrder:[...]}, elements:{ nodes:[{data:{...}}], edges:[{data:{source,target,...}}] } }

    const isOnexus =
        raw &&
        raw.elements &&
        Array.isArray(raw.elements.nodes) &&
        Array.isArray(raw.elements.edges);

    // ---------- B) ONEXUS style ----------
    if (isOnexus) {
        const arcOrder =
            raw.view && Array.isArray(raw.view.arcOrder) ? raw.view.arcOrder.slice() : null;

        const onodes = raw.elements.nodes.map(n => n.data);
        const oedges = raw.elements.edges.map(e => e.data);

        // Map ONEXUS nodeId -> chord leafId ("Category.Label")
        const idToLeafId = new Map();

        function labelOf(n) {
            const lbl = n.label || {};
            return (lbl.en || lbl.jp || n.name || n.id);
        }

        // Build leaf nodes expected by the renderer
        const chordNodes = onodes.map(n => {
            const category = n.category || n.nodeType || "Uncategorized";
            const label = String(labelOf(n)).replace(/\./g, "·"); // avoid dots breaking split(".")
            const leafId = `${category}.${label}`;
            idToLeafId.set(n.id, leafId);
            return { id: leafId, category, links: [] };
        });

        const chordById = new Map(chordNodes.map(n => [n.id, n]));

        // Convert edges to undirected links (the renderer already treats connections as pairs)
        oedges.forEach(e => {
            const a = idToLeafId.get(e.source);
            const b = idToLeafId.get(e.target);
            if (!a || !b || a === b) return;

            const na = chordById.get(a);
            const nb = chordById.get(b);
            if (!na || !nb) return;

            na.links.push(b);
            nb.links.push(a);
        });

        // Deduplicate links
        chordNodes.forEach(n => {
            n.links = Array.from(new Set(n.links));
        });

        return { arcOrder, nodes: chordNodes };
    }

    // ---------- A) Existing chord style ----------
    const nodes = Array.isArray(raw) ? raw : (raw && raw.nodes ? raw.nodes : []);
    const arcOrder =
        (!Array.isArray(raw) && raw && Array.isArray(raw.arcOrder)) ? raw.arcOrder.slice() : null;

    return {
        arcOrder,
        nodes: nodes.map(d => ({
            id: d.id,
            category: d.category,
            links: Array.isArray(d.links) ? d.links.slice() : []
        }))
    };
}

function buildHierarchy(items, arcOrder) {
    const root = { name: "root", children: [] };
    const map = new Map();

    // Preserve deterministic category order:
    // - if arcOrder exists, use it (and append any missing categories at end)
    // - otherwise, insertion order from nodes
    const categoriesPresent = Array.from(new Set(items.map(d => d.category)));
    let orderedCats = categoriesPresent;

    if (Array.isArray(arcOrder) && arcOrder.length) {
        const set = new Set(categoriesPresent);
        const inOrder = arcOrder.filter(c => set.has(c));
        const remaining = categoriesPresent.filter(c => !arcOrder.includes(c));
        orderedCats = [...inOrder, ...remaining];
    }

    orderedCats.forEach(cat => {
        const node = { name: cat, children: [] };
        map.set(cat, node);
        root.children.push(node);
    });

    items.forEach(d => {
        if (!map.has(d.category)) {
            const node = { name: d.category, children: [] };
            map.set(d.category, node);
            root.children.push(node);
        }
        map.get(d.category).children.push({ name: d.id, data: d });
    });

    return root;
}

/* =====================================================
 Deterministic dense links (visual parity)
===================================================== */
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
}

function pickFromArray(arr, seed, count) {
    const out = [];
    if (!arr.length) return out;
    let s = seed >>> 0;
    for (let i = 0; i < count; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        out.push(arr[s % arr.length]);
    }
    return Array.from(new Set(out));
}

function addDeterministicLinks(items) {
    const byCategory = d3.group(items, d => d.category);
    const allIds = items.map(d => d.id);

    function makeTargets(node) {
        const seed = hashString(node.id);
        const local = (byCategory.get(node.category) ?? [])
            .map(d => d.id)
            .filter(id => id !== node.id);
        const others = allIds.filter(id => !id.startsWith(node.category + "."));

        const localPick = pickFromArray(local, seed ^ 0xA5A5A5A5, 1);
        const otherPick = pickFromArray(others, seed ^ 0x5A5A5A5A, 2);
        return [...localPick, ...otherPick].filter(Boolean);
    }

    const out = items.map(d => ({ ...d, links: d.links.slice() }));
    const idSet = new Set(allIds);

    out.forEach(d => {
        d.links = d.links.filter(t => idSet.has(t) && t !== d.id);
        if (d.links.length === 0) {
            d.links = makeTargets(d);
        } else if (d.links.length === 1) {
            const add = makeTargets(d).filter(t => !d.links.includes(t));
            if (add.length) d.links.push(add[0]);
        }
    });

    window.__EXPORT_DATA__ = () => {
        const json = JSON.stringify(out, null, 2);
        console.log(json);
        return json;
    };

    return out;
}

/* =====================================================
 Text measurement for auto radius
===================================================== */
function measureTextPx(text, font) {
    const canvas = measureTextPx._canvas
        || (measureTextPx._canvas = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    return ctx.measureText(text).width;
}

/* =====================================================
 Auto radius to prevent label clipping
===================================================== */
function computeAutoRadius(items) {
    const leafNames = items.map(d => (d.id.split(".")[1] ?? d.id));
    const maxLeaf = d3.max(leafNames, t => measureTextPx(t, LABEL_FONT)) ?? 120;
    const cats = Array.from(new Set(items.map(d => d.category)));
    const maxCat = d3.max(cats, t => measureTextPx(t, CAT_FONT)) ?? 80;

    const labelMargin = maxLeaf + 34;
    const catMargin = maxCat * 0.25 + 20;
    const margin = Math.max(labelMargin, catMargin) + 14;

    const r = Math.min(WIDTH, HEIGHT) / 2 - margin;
    return Math.max(260, Math.min(410, r));
}

/* =====================================================
 Geometry helpers
===================================================== */
function normalizeAngle(a) {
    const twoPi = 2 * Math.PI;
    return ((a % twoPi) + twoPi) % twoPi;
}

function polarPoint(r, a) {
    // matches d3 arc angle convention: 0 at 12 o'clock, positive clockwise
    return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
}

/**
 * Direction-correct arc path:
 * - expects a0, a1 in a consistent frame (may exceed 2π for wrap representation)
 * - computes largeArc from abs(delta)
 * - sweep flag based on delta sign
 */
function arcPathD(r, a0, a1) {
    const [x0, y0] = polarPoint(r, a0);
    const [x1, y1] = polarPoint(r, a1);
    const delta = a1 - a0;
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweep = delta >= 0 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} ${sweep} ${x1} ${y1}`;
}

/* =====================================================
 Category span computation (FIX)
 - Produces stable, non-overlapping spans in [0,2π) with per-span wrap
 - Prevents “double label / empty neighbor” artifacts
===================================================== */
function computeCategorySpans(leaves, arcOrder) {
    // Group leaves by parent category name
    const byCat = d3.groups(leaves, d => d.parent.data.name)
        .map(([name, nodes]) => {
            const xs = nodes.map(n => normalizeAngle(n.x)).sort((a, b) => a - b);
            return { name, leafStart: xs[0], leafEnd: xs[xs.length - 1] };
        });

    // Order categories:
    // - if arcOrder exists, follow it (only those present)
    // - else order by leafStart angle
    let ordered = byCat.slice();
    if (Array.isArray(arcOrder) && arcOrder.length) {
        const map = new Map(ordered.map(d => [d.name, d]));
        const inOrder = arcOrder.map(n => map.get(n)).filter(Boolean);
        const remaining = ordered.filter(d => !arcOrder.includes(d.name));
        remaining.sort((a, b) => a.leafStart - b.leafStart);
        ordered = [...inOrder, ...remaining];
    } else {
        ordered.sort((a, b) => a.leafStart - b.leafStart);
    }

    // Compute boundaries using midpoints between adjacent groups,
    // but keep everything in [0,2π) then represent wrap by end<start => end+=2π
    const n = ordered.length;
    const spans = [];

    for (let i = 0; i < n; i++) {
        const prev = ordered[(i - 1 + n) % n];
        const cur = ordered[i];
        const next = ordered[(i + 1) % n];

        // Midpoint helper that respects circular wrap but returns normalized [0,2π)
        const mid = (a, b) => {
            const twoPi = 2 * Math.PI;
            a = normalizeAngle(a);
            b = normalizeAngle(b);
            // ensure b is ahead of a
            if (b < a) b += twoPi;
            const m = a + (b - a) / 2;
            return normalizeAngle(m);
        };

        let start = mid(prev.leafEnd, cur.leafStart);
        let end = mid(cur.leafEnd, next.leafStart);

        // If end falls "behind" start, represent wrap by adding 2π to end ONLY for this span
        let startN = normalizeAngle(start);
        let endN = normalizeAngle(end);
        if (endN <= startN) endN += 2 * Math.PI;

        spans.push({
            name: cur.name,
            startAngle: startN,
            endAngle: endN
        });
    }

    return spans;
}

/* =====================================================
 Render
===================================================== */
function render(payload) {
    const items = payload.nodes;
    const arcOrder = payload.arcOrder;

    const RADIUS = computeAutoRadius(items);
    const OUTER_ARC_RADIUS = RADIUS;
    const INNER_ARC_RADIUS = RADIUS - RING_THICKNESS;
    const LINK_RADIUS = RADIUS - 10;

    // Place the text path slightly toward the inner side of the red ring
    const RING_TEXT_RADIUS = INNER_ARC_RADIUS + (RING_THICKNESS * 0.5);

    const LABEL_RADIUS = RADIUS + 2;
    const LABEL_OFFSET = 5;
    const SEPARATOR_INSET = 0.5;

    const svg = d3.select("#chart")
        .attr("viewBox", [-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT]);

    svg.selectAll("*").remove();
    const defs = svg.append("defs");
    const g = svg.append("g");

    svg.on("click", () => {
        pinnedNode = null;
        reset();
    });

    /* ---- layout ---- */
    const cluster = d3.cluster().size([2 * Math.PI, LINK_RADIUS]);
    const root = d3.hierarchy(buildHierarchy(items, arcOrder));
    cluster(root);

    // compact leaf angles inside each category (Modulmatik tightness)
    root.children.forEach(group => {
        group.leaves().forEach(d => {
            d.x = group.x + (d.x - group.x) * 0.86;
        });
    });

    const leaves = root.leaves();
    const leafById = new Map(leaves.map(d => [d.data.name, d]));

    /* ---- links ---- */
    const line = d3.lineRadial()
        .curve(d3.curveBundle.beta(LINK_BUNDLE_BETA))
        .radius(d => d.y)
        .angle(d => d.x);

    const links = [];
    leaves.forEach(source => {
        const src = source.data.data;
        if (!src || !Array.isArray(src.links)) return;
        src.links.forEach(targetId => {
            const target = leafById.get(targetId);
            if (!target) return;
            links.push({ source, target, path: source.path(target) });
        });
    });

    // --- NEW: build adjacency (node -> connected nodes) for label highlighting ---
    const neighborMap = new Map(); // leafNode -> Set<leafNode>
    function addNeighbor(a, b) {
        let s = neighborMap.get(a);
        if (!s) { s = new Set(); neighborMap.set(a, s); }
        s.add(b);
    }
    links.forEach(l => {
        addNeighbor(l.source, l.target);
        addNeighbor(l.target, l.source);
    });

    // ---- links (two-pass: under + top) ----
    const linkG = g.append("g").attr("class", "links");

    // under-stroke first (behind)
    const linkUnderSel = linkG
        .selectAll("path.link-under")
        .data(links)
        .join("path")
        .attr("class", "link-under")
        .attr("d", d => line(d.path));

    // crisp top line
    const linkSel = linkG
        .selectAll("path.link")
        .data(links)
        .join("path")
        .attr("class", "link")
        .attr("d", d => line(d.path));

    // --- PERF: build node -> linkElements map so hover updates only connected paths ---
    const linkElsByNode = new Map();   // node -> Set<SVGPathElement>
    const underElsByNode = new Map();  // node -> Set<SVGPathElement>

    function addToMap(map, node, el) {
        let set = map.get(node);
        if (!set) { set = new Set(); map.set(node, set); }
        set.add(el);
    }

    // Attach DOM element refs to data, populate maps
    linkSel.each(function (d) {
        d._topEl = this;
        addToMap(linkElsByNode, d.source, this);
        addToMap(linkElsByNode, d.target, this);
    });

    linkUnderSel.each(function (d) {
        d._underEl = this;
        addToMap(underElsByNode, d.source, this);
        addToMap(underElsByNode, d.target, this);
    });

    // Track last hovered to clear only what we touched
    let _lastActiveTop = null;
    let _lastActiveUnder = null;
    let pinnedNode = null;

    /* ---- continuous ring (never gaps) ---- */
    const ringArc = d3.arc()
        .innerRadius(INNER_ARC_RADIUS)
        .outerRadius(OUTER_ARC_RADIUS)
        .startAngle(0)
        .endAngle(2 * Math.PI);

    g.append("path")
        .attr("class", "ring")
        .attr("d", ringArc());

    /* ---- category spans (FIXED) ---- */
    const categories = computeCategorySpans(leaves, arcOrder);

    // quick lookup: node -> category name
    const leafCategory = new Map(leaves.map(d => [d, d.parent.data.name]));

    /* ---- separators ---- */
    const sepAngles = categories.map(d => d.startAngle);
    g.append("g")
        .selectAll("line.separator")
        .data(sepAngles)
        .join("line")
        .attr("class", "separator")
        .attr("x1", a => polarPoint(INNER_ARC_RADIUS + SEPARATOR_INSET, a)[0])
        .attr("y1", a => polarPoint(INNER_ARC_RADIUS + SEPARATOR_INSET, a)[1])
        .attr("x2", a => polarPoint(OUTER_ARC_RADIUS - SEPARATOR_INSET, a)[0])
        .attr("y2", a => polarPoint(OUTER_ARC_RADIUS - SEPARATOR_INSET, a)[1]);

    /* =====================================================
     RING TEXT — upright + stable placement (FIXED)
     - build one path per category span with local wrap handled
     - reverse only the bottom-half paths (upright glyphs)
     - also swap anchoring so reversed paths still “read naturally”
    ===================================================== */
    const labelPad = 0.022; // keep away from separators
    const catBaseFont = 13;

    defs.selectAll("path.arc-label-path")
        .data(categories)
        .join("path")
        .attr("class", "arc-label-path")
        .attr("id", (_, i) => `arc-label-${i}`)
        .attr("d", d => {
            const a0 = d.startAngle + labelPad;
            const a1 = d.endAngle - labelPad;

            // Mid angle for top/bottom decision must be normalized back into [0,2π)
            const midRaw = (a0 + a1) / 2;
            const midN = normalizeAngle(midRaw);

            const bottomHalf = (midN > Math.PI / 2) && (midN < 3 * Math.PI / 2);
            d.bottomHalf = bottomHalf;

            // Reverse path direction only on bottom half to keep glyphs upright
            return bottomHalf
                ? arcPathD(RING_TEXT_RADIUS, a1, a0)
                : arcPathD(RING_TEXT_RADIUS, a0, a1);
        });

    g.append("g")
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

            const textWidth = measureTextPx(d.name, CAT_FONT);
            const shrink = Math.min(1, available / Math.max(1, textWidth));
            const fontSize = Math.max(10, Math.round(catBaseFont * shrink));

            // If the path is reversed (bottomHalf), use end anchoring so label sits consistently
            const startOffset = d.bottomHalf ? "94%" : "6%";
            const anchor = d.bottomHalf ? "end" : "start";

            const t = d3.select(this)
                .attr("font-size", fontSize)
                .attr("text-anchor", anchor);

            t.append("textPath")
                .attr("href", `#arc-label-${i}`)
                .attr("xlink:href", `#arc-label-${i}`)
                .attr("startOffset", startOffset)
                .text(d.name);
        })
        .on("mouseenter", (_, d) => focusCategory(d.name))
        .on("mouseleave", clearFocus);

    // Invisible hit segments for easier category hover (optional)
    const hitArc = d3.arc()
        .innerRadius(INNER_ARC_RADIUS)
        .outerRadius(OUTER_ARC_RADIUS);

    g.append("g")
        .selectAll("path.ring-segment-hit")
        .data(categories)
        .join("path")
        .attr("class", "ring-segment-hit")
        .attr("d", d => hitArc({ startAngle: d.startAngle, endAngle: d.endAngle }))
        .on("mouseenter", (_, d) => focusCategory(d.name))
        .on("mouseleave", clearFocus);

    /* ---- outer labels ---- */
    const nodeSel = g.append("g")
        .selectAll(".node")
        .data(leaves)
        .join("g")
        .attr("transform", d => {
            const a = (d.x * 180) / Math.PI - 90;
            return `rotate(${a}) translate(${LABEL_RADIUS},0)`;
        });

    const nodeText = nodeSel.append("text")
        .attr("class", "node-label")
        .attr("dy", "0.32em")
        .attr("x", d => (d.x < Math.PI ? LABEL_OFFSET : -LABEL_OFFSET))
        .attr("text-anchor", d => (d.x < Math.PI ? "start" : "end"))
        .attr("transform", d => (d.x >= Math.PI ? "rotate(180)" : null))
        .text(d => (d.data.name.split(".")[1] ?? d.data.name))
        .on("mouseenter", (_, d) => { if (!pinnedNode) highlight(d); })
        .on("mouseleave", () => { if (!pinnedNode) reset(); })
        .on("click", (event, d) => {
            event.stopPropagation();
            if (pinnedNode === d) {
                pinnedNode = null;
                reset();
            } else {
                pinnedNode = d;
                highlight(d);
            }
        });

    /* ---- interaction ---- */
    function highlight(node) {
        const neighbors = neighborMap.get(node) || new Set();
        nodeText
            .classed("active", d => d === node)
            .classed("connected", d => neighbors.has(d));

        // Fade everything with ONE class toggle on container
        linkG.classed("has-focus", true);

        // Clear previously activated subset only
        if (_lastActiveTop) {
            _lastActiveTop.forEach(el => el.classList.remove("active"));
        }
        if (_lastActiveUnder) {
            _lastActiveUnder.forEach(el => el.classList.remove("active"));
        }

        // Activate only the connected subset
        const topSet = linkElsByNode.get(node) || new Set();
        const underSet = underElsByNode.get(node) || new Set();

        topSet.forEach(el => el.classList.add("active"));
        underSet.forEach(el => el.classList.add("active"));

        _lastActiveTop = topSet;
        _lastActiveUnder = underSet;
    }

    function reset() {
        nodeText.classed("active", false);

        linkG.classed("has-focus", false);

        if (_lastActiveTop) _lastActiveTop.forEach(el => el.classList.remove("active"));
        if (_lastActiveUnder) _lastActiveUnder.forEach(el => el.classList.remove("active"));

        _lastActiveTop = null;
        _lastActiveUnder = null;
    }

    function focusCategory(categoryName) {
        // fade all nodes that are not in the category
        nodeText.classed("faded", d => d.parent.data.name !== categoryName);

        // fade links that don't touch the category
        linkSel.classed("faded", l =>
            l.source.parent.data.name !== categoryName &&
            l.target.parent.data.name !== categoryName
        );
    }

    function clearFocus() {
        nodeText.classed("faded", false);
        linkSel.classed("faded", false);
    }

    /* ---- auto-fit scaling to prevent label clipping ---- */
    requestAnimationFrame(() => {
        const bbox = g.node().getBBox();
        if (!bbox || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

        const availW = WIDTH - FIT_PADDING * 2;
        const availH = HEIGHT - FIT_PADDING * 2;
        const scale = Math.min(
            FIT_MAX_SCALE,
            availW / bbox.width,
            availH / bbox.height
        );

        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        g.attr("transform", `translate(${-cx * scale},${-cy * scale}) scale(${scale})`);
    });
}