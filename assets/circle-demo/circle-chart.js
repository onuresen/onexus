/* =====================================================
 Circular edge-bundling — visual parity pass
 - Loads data from data.json
 - Continuous ring (never gaps) + separators
 - Tangential tight labels with auto-fit scaling
 - Ring text: FIXED arc direction + NO glyph stretching (Modulmatik-like)
 - Dense deterministic connections for empty-link nodes
===================================================== */

const WIDTH = 1000;
const HEIGHT = 1000;
const DATA_URL = "data.json";

/* ---- visual tuning knobs (safe to tweak) ---- */
const RING_THICKNESS = 22;
const LINK_BUNDLE_BETA = 0.97;

const LABEL_FONT = '11px Montserrat, Arial, sans-serif';
const CAT_FONT = '600 13px Montserrat, Arial, sans-serif';

const FIT_PADDING = 22;     // slightly tighter, still safe
const FIT_MAX_SCALE = 1.0;  // never enlarge beyond 1

/* =====================================================
 Load + Init
===================================================== */
d3.json(DATA_URL).then(raw => {
    const data = normalizeData(raw);
    const enriched = addDeterministicLinks(data); // make density Modulmatik-like
    render(enriched);
}).catch(err => {
    console.error("Failed to load data.json. Run via a local server (Live Server).", err);
});

/* =====================================================
 Data helpers
===================================================== */
function normalizeData(raw) {
    // Accept either:
    // 1) array of {id, category, links}
    // 2) object { nodes: [...] }
    const arr = Array.isArray(raw) ? raw : (raw && raw.nodes ? raw.nodes : []);
    return arr.map(d => ({
        id: d.id,
        category: d.category,
        links: Array.isArray(d.links) ? d.links.slice() : []
    }));
}

function buildHierarchy(items) {
    const root = { name: "root", children: [] };
    const map = new Map();
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
 - For nodes with 0 links, create 1–3 links stably
 - Uses a hash-based pseudo-random so the same id => same targets always
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

        // 1 local + 2 cross-category feels close to Modulmatik density
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
    const canvas = measureTextPx._canvas || (measureTextPx._canvas = document.createElement("canvas"));
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

function midAngle(a, b) {
    const twoPi = 2 * Math.PI;
    a = normalizeAngle(a);
    b = normalizeAngle(b);
    if (b < a) b += twoPi;
    return a + (b - a) / 2;
}

function polarPoint(r, a) {
    // matches d3 arc angle convention: 0 at 12 o'clock, positive clockwise
    return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
}

/**
 * FIXED arc path generator:
 * - Works for BOTH directions (a1 > a0 and a1 < a0)
 * - Computes largeArc from abs(delta)
 * - Sets sweep flag based on delta sign
 */
function arcPathD(r, a0, a1) {
    const [x0, y0] = polarPoint(r, a0);
    const [x1, y1] = polarPoint(r, a1);

    const delta = a1 - a0;
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;

    // With our angle convention, delta>0 means clockwise.
    // SVG sweep=1 draws the arc in the "positive-angle" direction.
    const sweep = delta >= 0 ? 1 : 0;

    return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} ${sweep} ${x1} ${y1}`;
}

/* =====================================================
 Render
===================================================== */
function render(items) {
    const RADIUS = computeAutoRadius(items);

    const OUTER_ARC_RADIUS = RADIUS;
    const INNER_ARC_RADIUS = RADIUS - RING_THICKNESS;

    const LINK_RADIUS = RADIUS - 10;
    // Place the text path slightly toward the inner side of the red ring.
    // This is more stable than using dy for radial positioning.
    const RING_TEXT_RADIUS = INNER_ARC_RADIUS + (RING_THICKNESS * 0.5);

    // slightly tighter outer label placement
    const LABEL_RADIUS = RADIUS + 2;
    const LABEL_OFFSET = 5;

    const SEPARATOR_INSET = 0.5;

    const svg = d3.select("#chart")
        .attr("viewBox", [-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT]);

    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const g = svg.append("g");

    /* ---- layout ---- */
    const cluster = d3.cluster().size([2 * Math.PI, LINK_RADIUS]);
    const root = d3.hierarchy(buildHierarchy(items));
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

    const linkSel = g.append("g")
        .selectAll(".link")
        .data(links)
        .join("path")
        .attr("class", "link")
        .attr("d", d => line(d.path));

    /* ---- continuous ring (never gaps) ---- */
    const ringArc = d3.arc()
        .innerRadius(INNER_ARC_RADIUS)
        .outerRadius(OUTER_ARC_RADIUS)
        .startAngle(0)
        .endAngle(2 * Math.PI);

    g.append("path")
        .attr("class", "ring")
        .attr("d", ringArc());

    /* ---- category boundaries (for separators + label spans) ---- */
    const groups = d3.groups(leaves, d => d.parent.data.name)
        .map(([name, nodes]) => {
            const xs = nodes.map(n => normalizeAngle(n.x)).sort((a, b) => a - b);
            return { name, leafStart: xs[0], leafEnd: xs[xs.length - 1] };
        })
        .sort((a, b) => a.leafStart - b.leafStart);

    let categories = groups.map((d, i, arr) => {
        const prev = arr[(i - 1 + arr.length) % arr.length];
        const next = arr[(i + 1) % arr.length];

        const start = midAngle(prev.leafEnd, d.leafStart);
        const end = midAngle(d.leafEnd, next.leafStart);

        return { name: d.name, startAngle: start, endAngle: end };
    });

    // make angles monotonic for stable drawing
    for (let i = 1; i < categories.length; i++) {
        while (categories[i].startAngle < categories[i - 1].startAngle) categories[i].startAngle += 2 * Math.PI;
        while (categories[i].endAngle < categories[i].startAngle) categories[i].endAngle += 2 * Math.PI;
    }

    /* ---- separators (white lines) ---- */
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
       RING TEXT — FIXED
       - path reversal for bottom half (upright)
       - arcPathD now direction-correct (sweep + largeArc)
       - NO textLength stretching (prevents awkward glyph flow)
       - Modulmatik-like placement (dy=16 + small start offset)
    ===================================================== */
    const labelPad = 0.022; // keep away from separators

    defs.selectAll("path.arc-label-path")
        .data(categories)
        .join("path")
        .attr("class", "arc-label-path")
        .attr("id", (_, i) => `arc-label-${i}`)
        .attr("d", d => {
            const a0 = d.startAngle + labelPad;
            const a1 = d.endAngle - labelPad;

            const mid = (a0 + a1) / 2;
            const midN = normalizeAngle(mid);

            const bottomHalf = (midN > Math.PI / 2) && (midN < 3 * Math.PI / 2);
            d.bottomHalf = bottomHalf;
            // reverse ONLY the path direction on bottom half
            return bottomHalf
                ? arcPathD(RING_TEXT_RADIUS, a1, a0)
                : arcPathD(RING_TEXT_RADIUS, a0, a1);
        });

    const catBaseFont = 13;

    g.append("g")
        .selectAll("text.arc-label")
        .data(categories)
        .join("text")
        .attr("class", "arc-label")
        .attr("dominant-baseline", "middle")
        .attr("dy", "0")
        .each(function (d, i) {
            // Keep font consistent; only shrink a bit if truly needed
            const a0 = d.startAngle + labelPad;
            const a1 = d.endAngle - labelPad;
            const span = Math.max(0.0001, Math.abs(a1 - a0));
            const available = RING_TEXT_RADIUS * span * 0.92;

            const textWidth = measureTextPx(d.name, CAT_FONT);
            const shrink = Math.min(1, available / Math.max(1, textWidth));
            const fontSize = Math.max(10, Math.round(catBaseFont * shrink));

            d3.select(this)
                .attr("font-size", fontSize)
                .append("textPath")
                .attr("href", `#arc-label-${i}`)
                .attr("xlink:href", `#arc-label-${i}`)
                .attr("startOffset", "6%")     // similar “x=5” feel
                .attr("text-anchor", "start")  // do NOT center (prevents awkward flow)
                .text(d.name);
        });

    /* ---- outer labels (tangential + tight like Modulmatik) ---- */
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
        .on("mouseenter", (_, d) => highlight(d))
        .on("mouseleave", reset);

    /* ---- interaction ---- */
    function highlight(node) {
        nodeText.classed("active", d => d === node);
        linkSel.classed("active", d => (d.source === node || d.target === node));
    }

    function reset() {
        nodeText.classed("active", false);
        linkSel.classed("active", false);
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