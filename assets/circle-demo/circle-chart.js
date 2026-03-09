/* =====================================================
   CONFIG (VISUAL POLISH PASS)
===================================================== */
const WIDTH = 1000;
const HEIGHT = 1000;

// Base circle radius
const RADIUS = 400;

// Radial layers (tuned for tighter look)
const LINK_RADIUS = RADIUS - 8;
const INNER_ARC_RADIUS = RADIUS - 22;
const OUTER_ARC_RADIUS = RADIUS;

// Text on the ring sits on its own path at mid thickness
const RING_TEXT_RADIUS = (INNER_ARC_RADIUS + OUTER_ARC_RADIUS) / 2;

// Leaf labels: tighter than before
const LABEL_RADIUS = RADIUS + 2;         // was +10
const LABEL_OFFSET = 6;                  // x offset from radial line

// Fit-to-view settings
const FIT_PADDING = 26;                  // px padding inside viewBox
const FIT_MAX_SCALE = 1.0;               // never enlarge beyond 1
const FIT_MIN_SCALE = 0.92;              // avoid over-shrinking for tiny labels

/* =====================================================
   DATA
===================================================== */
const data = [
    { id: "Management.Project Management", category: "Management", links: ["Regulations.Approvals", "Production.Factory Planning"] },
    { id: "Management.Cost Control", category: "Management", links: ["Production.Factory Planning", "Logistics.Transport"] },
    { id: "Management.Schedule Planning", category: "Management", links: ["Construction.Site Planning"] },
    { id: "Regulations.Approvals", category: "Regulations", links: ["Architecture.Design Development"] },
    { id: "Regulations.Building Codes", category: "Regulations", links: ["Architecture.Design Development"] },
    { id: "Architecture.Design Development", category: "Architecture", links: ["Production.Module Design", "MEP.System Coordination"] },
    { id: "Architecture.BIM Modeling", category: "Architecture", links: ["Production.Module Design"] },
    { id: "Architecture.Detailing", category: "Architecture", links: ["Production.Module Design"] },
    { id: "MEP.System Coordination", category: "MEP", links: ["Production.Module Design"] },
    { id: "MEP.Installation Planning", category: "MEP", links: ["Construction.Onsite Assembly"] },
    { id: "Production.Module Design", category: "Production", links: ["Production.Factory Planning"] },
    { id: "Production.Factory Planning", category: "Production", links: ["Logistics.Transport"] },
    { id: "Production.Quality Control", category: "Production", links: ["Construction.Onsite Assembly"] },
    { id: "Logistics.Transport", category: "Logistics", links: ["Construction.Onsite Assembly"] },
    { id: "Logistics.Site Delivery", category: "Logistics", links: ["Construction.Onsite Assembly"] },
    { id: "Construction.Site Planning", category: "Construction", links: ["Construction.Onsite Assembly"] },
    { id: "Construction.Onsite Assembly", category: "Construction", links: ["Operation.Maintenance"] },
    { id: "Operation.Maintenance", category: "Operation", links: ["Sustainability.Lifecycle Assessment"] },
    { id: "Sustainability.Lifecycle Assessment", category: "Sustainability", links: [] }
];

/* =====================================================
   HIERARCHY
===================================================== */
function buildHierarchy(items) {
    const root = { name: "root", children: [] };
    const map = new Map();

    items.forEach(d => {
        if (!map.has(d.category)) {
            const node = { name: d.category, children: [] };
            map.set(d.category, node);
            root.children.push(node);
        }
        // leaf node name becomes id, data keeps original record
        map.get(d.category).children.push({ name: d.id, data: d });
    });

    return root;
}

/* =====================================================
   SVG
===================================================== */
const svg = d3
    .select("#chart")
    .attr("viewBox", [-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT]);

// everything under one group so we can scale/center
const g = svg.append("g");

/* =====================================================
   LAYOUT
===================================================== */
const cluster = d3.cluster().size([2 * Math.PI, LINK_RADIUS]);

const root = d3.hierarchy(buildHierarchy(data));
cluster(root);

// tighten angles slightly inside each category to look more compact
root.children.forEach(group => {
    group.leaves().forEach(d => {
        d.x = group.x + (d.x - group.x) * 0.85;
    });
});

const leaves = root.leaves();
const leafById = new Map(leaves.map(d => [d.data.name, d]));

/* =====================================================
   LINKS
===================================================== */
const line = d3.lineRadial()
    .curve(d3.curveBundle.beta(0.97))
    .radius(d => d.y)
    .angle(d => d.x);

const links = [];
leaves.forEach(source => {
    source.data.data.links.forEach(targetId => {
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

/* =====================================================
   LEAF LABELS (tighter radius + nicer alignment)
===================================================== */
const nodeSel = g.append("g")
    .selectAll(".node")
    .data(leaves)
    .join("g")
    .attr("transform", d =>
        `rotate(${(d.x * 180) / Math.PI - 90}) translate(${LABEL_RADIUS},0)`
    );

const nodeText = nodeSel.append("text")
    .attr("class", "node-label")
    .attr("dy", "0.32em")
    .attr("x", d => (d.x < Math.PI ? LABEL_OFFSET : -LABEL_OFFSET))
    .attr("text-anchor", d => (d.x < Math.PI ? "start" : "end"))
    .attr("transform", d => (d.x >= Math.PI ? "rotate(180)" : null))
    .text(d => d.data.name.split(".")[1])
    .on("mouseenter", (_, d) => highlight(d))
    .on("mouseleave", reset);

/* =====================================================
   CATEGORY ARCS (continuous ring)
===================================================== */
const arc = d3.arc()
    .innerRadius(INNER_ARC_RADIUS)
    .outerRadius(OUTER_ARC_RADIUS);

const categories = d3.groups(leaves, d => d.parent.data.name)
    .map(([name, nodes]) => ({
        name,
        startAngle: d3.min(nodes, d => d.x),
        endAngle: d3.max(nodes, d => d.x)
    }))
    .sort((a, b) => a.startAngle - b.startAngle);

// close gaps between category wedges (continuous ring feel)
categories.forEach((d, i, arr) => {
    const next = arr[(i + 1) % arr.length];
    d.endAngle = (d.endAngle + next.startAngle) / 2;
});
categories[0].startAngle = categories[categories.length - 1].endAngle - 2 * Math.PI;

const arcG = g.append("g");

// arc segments (solid red)
arcG.selectAll("path.arc")
    .data(categories)
    .join("path")
    .attr("class", "arc")
    .attr("d", d => arc(d));

/* =====================================================
   CATEGORY TEXT (upright + consistent readability)
   Technique: build label paths; reverse on bottom half.
===================================================== */
const defs = svg.append("defs");

function polarToCartesian(r, a) {
    return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
}

function arcPathD(r, a0, a1) {
    const [x0, y0] = polarToCartesian(r, a0);
    const [x1, y1] = polarToCartesian(r, a1);
    const largeArc = (a1 - a0) % (2 * Math.PI) > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

// label paths
defs.selectAll("path.arc-label-path")
    .data(categories)
    .join("path")
    .attr("class", "arc-label-path")
    .attr("id", (_, i) => `arc-label-${i}`)
    .attr("d", d => {
        const mid = (d.startAngle + d.endAngle) / 2;
        const bottomHalf = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;

        // pad a tiny bit so text doesn't collide with wedge boundaries
        const pad = 0.012;
        const a0 = d.startAngle + pad;
        const a1 = d.endAngle - pad;

        // reverse path if on bottom half to keep text upright
        return bottomHalf
            ? arcPathD(RING_TEXT_RADIUS, a1, a0)
            : arcPathD(RING_TEXT_RADIUS, a0, a1);
    });

arcG.selectAll("text.arc-label")
    .data(categories)
    .join("text")
    .attr("class", "arc-label")
    .append("textPath")
    .attr("href", (_, i) => `#arc-label-${i}`)
    .attr("startOffset", "50%")
    .attr("text-anchor", "middle")
    .text(d => d.name);

/* =====================================================
   INTERACTION
===================================================== */
function highlight(node) {
    nodeText.classed("active", d => d === node);

    // FIX: was missing || (logical OR) in your file, causing wrong behavior

    linkSel.classed("active", d =>
        d.source === node || d.target === node
    );
}

function reset() {
    nodeText.classed("active", false);
    linkSel.classed("active", false);
}

/* =====================================================
   FINAL: subtle auto-fit scaling (compact + centered)
===================================================== */
requestAnimationFrame(() => {
    const bbox = g.node().getBBox();
    if (!bbox || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

    const availableW = WIDTH - FIT_PADDING * 2;
    const availableH = HEIGHT - FIT_PADDING * 2;

    const scale = Math.max(
        FIT_MIN_SCALE,
        Math.min(FIT_MAX_SCALE, availableW / bbox.width, availableH / bbox.height)
    );

    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    g.attr("transform", `translate(${-cx * scale},${-cy * scale}) scale(${scale})`);
});