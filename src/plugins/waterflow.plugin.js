/* =========================================================
 ONEXUS Plugin — Water Flow (conservative / playable overlay)
 - Water levels (0..1) per node; flow along edges from higher -> lower
 - Directed edges: source -> target only
 - Undirected edges: higher -> lower
 - CONSERVATIVE MODE: no leakage. Pumping takes from an auto reservoir node.
 - Canvas overlay: node tanks + edge droplets
 - UI injected into #panelAnim (no core edits)
========================================================= */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    // Optional shared overlay registry (plugin-only polyfill)
    ONX.overlay = ONX.overlay || (function () {
        const overlays = new Map();
        return {
            register(id, api) { overlays.set(String(id), api); return api; },
            get(id) { return overlays.get(String(id)); },
            list() { return Array.from(overlays.keys()); }
        };
    })();

    // -----------------------------
    // Config (tame defaults)
    // -----------------------------
    const CFG = {
        enabled: false,

        // Simulation (CONSERVATIVE)
        flowRate: 0.55,        // per second, fraction of diff transferred
        maxStep: 0.045,        // max transfer per edge per sim step
        damp: 0.0,             // ✅ conservative (no leakage)
        minLevel: 0.02,
        maxLevel: 0.98,

        // Interaction (pumping)
        pumpAmount: 0.18,      // Alt+Click tries to add this to clicked node
        pumpRadiusHops: 0,     // 0 only clicked; 1 includes neighbors
        conservativePump: true,// ✅ pumping pulls from reservoir
        reservoirMode: "auto", // ✅ default: auto
        reservoirFixedId: "",  // used only when reservoirMode=fixed

        // Visual
        nodeFillDefault: 0.55,
        wobble: 0.035,
        dropletDensity: 1.0,
        dropletSpeed: 1.0,
        dropletSize: 2.2,
        dropletGlow: 6,
        alpha: 0.85,

        // Safety cutoffs (visible graph)
        maxEdges: 2200,
        maxNodes: 3200,

        // Perf throttles
        fpsCapMs: 16,          // ~60fps
        simHz: 20              // sim steps per second (stable)
    };

    // -----------------------------
    // Runtime state
    // -----------------------------
    let canvas = null;
    let ctx = null;
    let dpr = 1;
    let raf = 0;

    let t0 = 0;
    let lastRenderMs = 0;
    let simAcc = 0;
    let lastMs = 0;

    // Water levels stored locally (avoid cy.data spam)
    const level = new Map(); // nodeId -> 0..1

    // Droplet offsets per edge
    const edgeCache = new Map(); // edgeId -> { offsets:number[], dirFlip:boolean }

    // -----------------------------
    // Utilities
    // -----------------------------
    function getCy() {
        return window.cy && typeof window.cy.nodes === "function" ? window.cy : null;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function exists(col) { return !!col && !!col.nonempty && col.nonempty(); }

    function seeded01(str) {
        let h = 2166136261;
        str = String(str ?? "");
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return ((h >>> 0) % 1000) / 1000;
    }

    function isDark() {
        const k = window.getCurrentThemeKey?.() ?? window.currentTheme ?? "light";
        return String(k).toLowerCase() === "dark";
    }

    function colors() {
        const water = isDark() ? "rgba(56, 189, 248, 0.62)" : "rgba(14, 165, 233, 0.55)";
        const waterDeep = isDark() ? "rgba(2, 132, 199, 0.68)" : "rgba(2, 132, 199, 0.55)";
        const glow = isDark() ? "rgba(56, 189, 248, 0.35)" : "rgba(14, 165, 233, 0.30)";
        const foam = isDark() ? "rgba(224, 242, 254, 0.45)" : "rgba(224, 242, 254, 0.55)";
        const outline = isDark() ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.12)";
        return { water, waterDeep, glow, foam, outline };
    }

    // -----------------------------
    // Canvas overlay
    // -----------------------------
    function ensureCanvas() {
        const cy = getCy();
        if (!cy) return null;
        const host = cy.container();
        if (!host) return null;

        if (canvas && canvas.isConnected && ctx) return canvas;

        canvas = document.createElement("canvas");
        canvas.id = "onx-waterflow-canvas";
        Object.assign(canvas.style, {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            zIndex: "5" // below link drag canvas (z=6) if present
        });

        try { if (getComputedStyle(host).position === "static") host.style.position = "relative"; } catch { }
        host.appendChild(canvas);

        ctx = canvas.getContext("2d", { alpha: true });
        resizeCanvas();
        return canvas;
    }

    function resizeCanvas() {
        const cy = getCy();
        if (!cy || !canvas || !ctx) return;
        const host = cy.container();
        if (!host) return;

        const rect = host.getBoundingClientRect();
        dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        canvas.style.width = rect.width + "px";
        canvas.style.height = rect.height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function clear() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }

    // -----------------------------
    // Water state init / access
    // -----------------------------
    function getLevel(id, seed = null) {
        const key = String(id);
        if (level.has(key)) return level.get(key);
        const s = (seed == null) ? seeded01(key) : seed;
        const v = clamp(CFG.nodeFillDefault + (s - 0.5) * 0.25, CFG.minLevel, CFG.maxLevel);
        level.set(key, v);
        return v;
    }

    function setLevel(id, v) {
        level.set(String(id), clamp(v, CFG.minLevel, CFG.maxLevel));
    }

    function initFromGraph() {
        const cy = getCy();
        if (!cy) return;
        level.clear();
        cy.nodes().forEach(n => {
            const d = n.data?.() || {};
            const id = d.id || n.id();
            const w = d.waterLevel;
            if (typeof w === "number" && Number.isFinite(w)) setLevel(id, w);
            else getLevel(id, seeded01(id));
        });
    }

    // -----------------------------
    // Simulation: conservative flow
    // -----------------------------
    function safetyCutoff(cy) {
        const vn = cy.nodes(":visible").length;
        const ve = cy.edges(":visible").length;
        return (vn <= CFG.maxNodes && ve <= CFG.maxEdges);
    }

    function stepSimulation(dt) {
        const cy = getCy();
        if (!cy) return;
        if (!safetyCutoff(cy)) return;

        const nodes = cy.nodes(":visible");
        const edges = cy.edges(":visible");

        const delta = new Map(); // id -> +/- change
        const addDelta = (id, dv) => {
            const k = String(id);
            delta.set(k, (delta.get(k) || 0) + dv);
        };

        edges.forEach(e => {
            const d = e.data?.() || {};
            const sId = String(d.source ?? e.source().id());
            const tId = String(d.target ?? e.target().id());

            const sL = getLevel(sId);
            const tL = getLevel(tId);

            const dir = !!d.directional;

            if (dir) {
                const diff = sL - tL;
                if (diff <= 0.0001) return;
                const raw = diff * CFG.flowRate * dt;
                const amt = Math.min(CFG.maxStep, raw);
                if (amt <= 0) return;
                addDelta(sId, -amt);
                addDelta(tId, +amt);
            } else {
                const diff = sL - tL;
                if (Math.abs(diff) <= 0.0001) return;
                const raw = Math.abs(diff) * CFG.flowRate * dt;
                const amt = Math.min(CFG.maxStep, raw);
                if (amt <= 0) return;
                if (diff > 0) { addDelta(sId, -amt); addDelta(tId, +amt); }
                else { addDelta(tId, -amt); addDelta(sId, +amt); }
            }
        });

        // Apply deltas (NO damp; conservative)
        nodes.forEach(n => {
            const id = String(n.id());
            const v0 = getLevel(id);
            const dv = delta.get(id) || 0;
            setLevel(id, v0 + dv);
        });
    }

    // -----------------------------
    // Visuals: node tanks + droplets
    // -----------------------------
    function particleOffsetsForEdge(edgeId, count) {
        let entry = edgeCache.get(edgeId);
        if (!entry || !Array.isArray(entry.offsets) || entry.offsets.length !== count) {
            const offsets = [];
            for (let i = 0; i < count; i++) {
                const base = (i / Math.max(1, count));
                const jitter = (seeded01(edgeId + ":" + i) - 0.5) * 0.15;
                offsets.push((base + jitter + 1) % 1);
            }
            entry = entry || {};
            entry.offsets = offsets;
            entry.dirFlip = seeded01(edgeId + ":flip") > 0.5;
            edgeCache.set(edgeId, entry);
        }
        return entry;
    }

    function drawNodeTank(n, tSec, C) {
        const bb = n.renderedBoundingBox ? n.renderedBoundingBox() : null;
        if (!bb) return;

        const cx = (bb.x1 + bb.x2) / 2;
        const cyy = (bb.y1 + bb.y2) / 2;
        const r = Math.max(10, Math.min(bb.w, bb.h) * 0.38);

        const id = n.id();
        const seed = seeded01(id);
        const v = getLevel(id, seed);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cyy, r, 0, Math.PI * 2);
        ctx.clip();

        const yWater = cyy + r - (2 * r * v);

        const grad = ctx.createLinearGradient(cx, cyy - r, cx, cyy + r);
        grad.addColorStop(0, C.water);
        grad.addColorStop(1, C.waterDeep);
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.fillRect(cx - r, yWater, 2 * r, (cyy + r) - yWater);

        const amp = clamp(CFG.wobble, 0, 0.12) * r;
        const freq = 6.0 + seed * 3.5;
        const phase = tSec * (1.6 + CFG.dropletSpeed * 1.2) + seed * 10.0;

        ctx.beginPath();
        const left = cx - r - 2;
        const right = cx + r + 2;
        const step = Math.max(6, Math.floor(r / 6));
        ctx.moveTo(left, yWater);
        for (let x = left; x <= right; x += step) {
            const k = (x - left) / (right - left);
            const y = yWater + Math.sin(k * freq * Math.PI * 2 + phase) * amp;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(right, cyy + r + 2);
        ctx.lineTo(left, cyy + r + 2);
        ctx.closePath();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = C.foam;
        ctx.fill();

        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = C.outline;
        ctx.beginPath();
        ctx.arc(cx, cyy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawEdgeDroplets(e, tSec, C) {
        const d = e.data?.() || {};
        const src = e.source();
        const tgt = e.target();
        if (!src || !tgt) return;

        const a = src.renderedPosition();
        const b = tgt.renderedPosition();
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (!Number.isFinite(len) || len < 18) return;

        const sId = String(d.source ?? src.id());
        const tId = String(d.target ?? tgt.id());
        const sL = getLevel(sId), tL = getLevel(tId);

        const dir = !!d.directional;
        let showForward = false;
        let showBackward = false;

        if (dir) showForward = (sL > tL + 0.02);
        else {
            showForward = (sL > tL + 0.02);
            showBackward = (tL > sL + 0.02);
        }
        if (!showForward && !showBackward) return;

        const baseCount = Math.max(2, Math.floor((len / 140) * 4 * CFG.dropletDensity));
        const count = clamp(baseCount, 2, 14);
        const cache = particleOffsetsForEdge(e.id(), count);

        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;

        const drawDir = (forward, alphaMul) => {
            ctx.save();
            ctx.globalAlpha = CFG.alpha * alphaMul;
            ctx.shadowColor = C.glow;
            ctx.shadowBlur = CFG.dropletGlow;

            for (let i = 0; i < count; i++) {
                const off = cache.offsets[i];
                const spd = (0.18 + (i % 5) * 0.03) * CFG.dropletSpeed;
                const tt = (tSec * spd + off) % 1;
                const t = forward ? tt : (1 - tt);

                const px = a.x + dx * t;
                const py = a.y + dy * t;

                const wob = Math.sin(tSec * (2.2 + i * 0.1) + off * 12) * 1.1;
                const wx = px + nx * wob;
                const wy = py + ny * wob;

                const r = CFG.dropletSize * (0.85 + (i % 3) * 0.12);
                ctx.beginPath();
                ctx.fillStyle = C.waterDeep;
                ctx.arc(wx, wy, r, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        };

        if (showForward) drawDir(true, 1.0);
        if (showBackward) drawDir(false, 0.75);
    }

    // -----------------------------
    // Main loop
    // -----------------------------
    function frame(ms) {
        if (!CFG.enabled) return;
        const cy = getCy();
        if (!cy) return;

        if (!t0) t0 = ms;
        if (!lastMs) lastMs = ms;

        const dtRender = (ms - lastMs) / 1000;
        lastMs = ms;

        // fixed sim step
        simAcc += dtRender;
        const simStep = 1 / CFG.simHz;
        while (simAcc >= simStep) {
            stepSimulation(simStep);
            simAcc -= simStep;
        }

        // render throttle
        if (lastRenderMs && (ms - lastRenderMs) < CFG.fpsCapMs) {
            raf = requestAnimationFrame(frame);
            return;
        }
        lastRenderMs = ms;

        ensureCanvas();
        if (!canvas || !ctx) { raf = requestAnimationFrame(frame); return; }

        // resize if needed
        const host = cy.container();
        if (host) {
            const r = host.getBoundingClientRect();
            const w = Math.floor(r.width * dpr);
            const h = Math.floor(r.height * dpr);
            if (canvas.width !== w || canvas.height !== h) resizeCanvas();
        }

        clear();

        if (!safetyCutoff(cy)) {
            raf = requestAnimationFrame(frame);
            return;
        }

        const tSec = (ms - t0) / 1000;
        const C = colors();

        cy.edges(":visible").forEach(e => { try { drawEdgeDroplets(e, tSec, C); } catch { } });
        cy.nodes(":visible").forEach(n => { try { drawNodeTank(n, tSec, C); } catch { } });

        raf = requestAnimationFrame(frame);
    }

    // -----------------------------
    // Conservative pumping (Auto reservoir)
    // -----------------------------
    function pickReservoirNode(clickedNode) {
        const cy = getCy();
        if (!cy) return null;

        // default "auto" behavior:
        // - Prefer a System node if present
        // - Else highest-degree visible node
        // - Else first visible node
        let sys = cy.nodes(':visible[nodeType = "System"]');
        if (sys && sys.length) return sys[0];
        const hubs = cy.nodes(":visible").sort((a, b) => b.degree(false) - a.degree(false));
        if (hubs && hubs.length) return hubs[0];
        const any = cy.nodes(":visible")[0];
        return any || null;
    }

    function neighborsWithinHops(node, hops) {
        const cy = getCy();
        if (!cy || !node) return cy.collection();
        if (hops <= 0) return node.collection();

        let frontier = node.collection();
        let seen = frontier;
        for (let h = 0; h < hops; h++) {
            const hood = frontier.closedNeighborhood(":visible").nodes(":visible");
            seen = seen.union(hood);
            frontier = hood;
        }
        return seen;
    }

    function pumpNode(node) {
        const cy = getCy();
        if (!cy || !node) return;

        const pack = neighborsWithinHops(node, CFG.pumpRadiusHops);

        const centerId = node.id();
        const targets = [];
        let totalAdd = 0;

        pack.forEach(n => {
            const id = n.id();
            const mul = (id === centerId) ? 1.0 : 0.45;
            const want = CFG.pumpAmount * mul;

            const cur = getLevel(id);
            const headroom = CFG.maxLevel - cur;
            const add = Math.max(0, Math.min(want, headroom));
            if (add > 0) {
                targets.push({ id, add });
                totalAdd += add;
            }
        });

        if (totalAdd <= 0.00001) return;

        const resNode = pickReservoirNode(node);
        if (!resNode) {
            window.showTransientMessage?.("No reservoir node found", 1200);
            return;
        }
        const resId = resNode.id();

        const resCur = getLevel(resId);
        const available = Math.max(0, resCur - CFG.minLevel);
        const take = Math.min(available, totalAdd);

        if (take <= 0.00001) {
            window.showTransientMessage?.("Reservoir too low", 1000);
            return;
        }

        const scale = take / totalAdd;

        setLevel(resId, resCur - take);
        targets.forEach(t => setLevel(t.id, getLevel(t.id) + t.add * scale));

        window.showTransientMessage?.(`Pump: +${Math.round(take * 100)}%`, 900);
    }

    function onNodeTap(evt) {
        if (!CFG.enabled) return;
        const oe = evt?.originalEvent;
        if (!oe || !oe.altKey) return; // play-mode only

        const node = evt.target;
        if (!node || !node.isNode || !node.isNode()) return;

        pumpNode(node);
    }

    // -----------------------------
    // Controls
    // -----------------------------
    function start() {
        if (CFG.enabled) return;
        CFG.enabled = true;

        const cy = getCy();
        if (!cy) { CFG.enabled = false; return; }

        initFromGraph();
        ensureCanvas();
        resizeCanvas();

        t0 = 0; lastMs = 0; lastRenderMs = 0; simAcc = 0;
        edgeCache.clear();

        if (!cy._onxWaterFlowTapHooked) {
            cy._onxWaterFlowTapHooked = true;
            cy.on("tap", "node", onNodeTap);
        }

        raf = requestAnimationFrame(frame);
        window.showTransientMessage?.("Water Flow: ON (Alt+Click to pump)", 1800);
    }

    function stop({ commitToNodeData = false } = {}) {
        if (!CFG.enabled) return;
        CFG.enabled = false;

        if (raf) cancelAnimationFrame(raf);
        raf = 0;

        if (commitToNodeData) {
            const cy = getCy();
            if (cy) {
                cy.nodes().forEach(n => {
                    const id = n.id();
                    const v = level.get(id);
                    if (typeof v === "number") n.data("waterLevel", v);
                });
            }
        }

        edgeCache.clear();
        clear();
        window.showTransientMessage?.("Water Flow: OFF", 1200);
    }

    function toggle() { CFG.enabled ? stop() : start(); }

    function setOptions(patch = {}) {
        if (!patch || typeof patch !== "object") return;
        Object.assign(CFG, patch);

        CFG.flowRate = clamp(Number(CFG.flowRate ?? 0.55), 0.05, 2.5);
        CFG.maxStep = clamp(Number(CFG.maxStep ?? 0.045), 0.002, 0.20);
        CFG.damp = 0.0; // ✅ enforce conservative

        CFG.pumpAmount = clamp(Number(CFG.pumpAmount ?? 0.18), 0.01, 0.60);
        CFG.pumpRadiusHops = clamp(Number(CFG.pumpRadiusHops ?? 0), 0, 2);

        CFG.nodeFillDefault = clamp(Number(CFG.nodeFillDefault ?? 0.55), 0.05, 0.95);
        CFG.wobble = clamp(Number(CFG.wobble ?? 0.035), 0.0, 0.12);

        CFG.dropletDensity = clamp(Number(CFG.dropletDensity ?? 1.0), 0.2, 4.0);
        CFG.dropletSpeed = clamp(Number(CFG.dropletSpeed ?? 1.0), 0.2, 6.0);
        CFG.dropletSize = clamp(Number(CFG.dropletSize ?? 2.2), 1.0, 6.0);
        CFG.dropletGlow = clamp(Number(CFG.dropletGlow ?? 6), 0, 20);
        CFG.alpha = clamp(Number(CFG.alpha ?? 0.85), 0.1, 1.0);

        CFG.simHz = clamp(Number(CFG.simHz ?? 20), 6, 60);
        edgeCache.clear();
    }

    // -----------------------------
    // UI injection into Anim panel (#panelAnim)
    // -----------------------------
    function ensureUI() {
        const panel = document.getElementById("panelAnim");
        if (!panel) return; // panel exists in your layout
        if (panel.querySelector("#onxWaterFlowPanel")) return;

        const wrap = document.createElement("div");
        wrap.id = "onxWaterFlowPanel";
        wrap.style.marginTop = "14px";
        wrap.style.paddingTop = "10px";
        wrap.style.borderTop = "1px solid var(--stroke)";

        wrap.innerHTML = `
      <h3>Water Flow (conservative)</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="flat" id="onxWaterFlowToggle" style="width:auto;min-width:190px;">Water Flow: Off</button>
        <span style="font-size:11px;color:var(--text-muted);line-height:1.35;">Alt+Click pumps (auto reservoir)</span>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span style="font-size:11px;color:var(--text-muted);min-width:86px;">Flow rate</span>
        <input id="onxWaterFlowRate" type="range" min="0.10" max="1.50" step="0.05" value="${CFG.flowRate}" style="flex:1;">
        <span id="onxWaterFlowRateLbl" style="font-size:11px;color:var(--text-muted);min-width:44px;">${CFG.flowRate.toFixed(2)}</span>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:11px;color:var(--text-muted);min-width:86px;">Pump</span>
        <input id="onxWaterFlowPump" type="range" min="0.05" max="0.45" step="0.01" value="${CFG.pumpAmount}" style="flex:1;">
        <span id="onxWaterFlowPumpLbl" style="font-size:11px;color:var(--text-muted);min-width:44px;">${Math.round(CFG.pumpAmount * 100)}%</span>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:11px;color:var(--text-muted);min-width:86px;">Droplets</span>
        <input id="onxWaterFlowDen" type="range" min="0.30" max="3.00" step="0.10" value="${CFG.dropletDensity}" style="flex:1;">
        <span id="onxWaterFlowDenLbl" style="font-size:11px;color:var(--text-muted);min-width:44px;">${CFG.dropletDensity.toFixed(1)}×</span>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:11px;color:var(--text-muted);min-width:86px;">Tank fill</span>
        <input id="onxWaterFlowFill" type="range" min="0.10" max="0.90" step="0.01" value="${CFG.nodeFillDefault}" style="flex:1;">
        <span id="onxWaterFlowFillLbl" style="font-size:11px;color:var(--text-muted);min-width:44px;">${Math.round(CFG.nodeFillDefault * 100)}%</span>
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">
        <button class="flat" id="onxWaterFlowReset" style="width:auto;min-width:120px;">Reset levels</button>
        <button class="flat" id="onxWaterFlowCommit" style="width:auto;min-width:160px;">Stop + Commit</button>
      </div>

      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.35;">
        Directed edges = one-way pipes. Undirected = higher → lower. Total water conserved.
      </div>
    `;

        panel.appendChild(wrap);

        const $ = (sel) => wrap.querySelector(sel);
        const btn = $("#onxWaterFlowToggle");
        const rate = $("#onxWaterFlowRate");
        const rateLbl = $("#onxWaterFlowRateLbl");
        const pump = $("#onxWaterFlowPump");
        const pumpLbl = $("#onxWaterFlowPumpLbl");
        const den = $("#onxWaterFlowDen");
        const denLbl = $("#onxWaterFlowDenLbl");
        const fill = $("#onxWaterFlowFill");
        const fillLbl = $("#onxWaterFlowFillLbl");
        const resetBtn = $("#onxWaterFlowReset");
        const commitBtn = $("#onxWaterFlowCommit");

        function syncBtn() { btn.textContent = CFG.enabled ? "Water Flow: On" : "Water Flow: Off"; }

        btn.addEventListener("click", () => { toggle(); syncBtn(); });

        rate.addEventListener("input", () => {
            const v = Number(rate.value);
            setOptions({ flowRate: v });
            rateLbl.textContent = v.toFixed(2);
        });

        pump.addEventListener("input", () => {
            const v = Number(pump.value);
            setOptions({ pumpAmount: v });
            pumpLbl.textContent = `${Math.round(v * 100)}%`;
        });

        den.addEventListener("input", () => {
            const v = Number(den.value);
            setOptions({ dropletDensity: v });
            denLbl.textContent = `${v.toFixed(1)}×`;
        });

        fill.addEventListener("input", () => {
            const v = Number(fill.value);
            setOptions({ nodeFillDefault: v });
            fillLbl.textContent = `${Math.round(v * 100)}%`;
        });

        resetBtn.addEventListener("click", () => {
            initFromGraph();
            window.showTransientMessage?.("Water levels reset", 1000);
        });

        commitBtn.addEventListener("click", () => {
            stop({ commitToNodeData: true });
            syncBtn();
            window.showTransientMessage?.("Committed node.data.waterLevel", 1400);
        });

        syncBtn();
    }

    // -----------------------------
    // Hook
    // -----------------------------
    function hook() {
        const cy = getCy();
        if (!cy) return;

        window.addEventListener("resize", () => { if (CFG.enabled) resizeCanvas(); });

        // Graph lifecycle events exist via bus
        try {
            ONX.bus?.on?.("graphWillLoad", () => { edgeCache.clear(); });
            ONX.bus?.on?.("graphLoaded", () => { if (CFG.enabled) { initFromGraph(); edgeCache.clear(); } });
        } catch { }

        ensureUI();
        setTimeout(ensureUI, 250);
        setTimeout(ensureUI, 700);
    }

    // -----------------------------
    // Expose API
    // -----------------------------
    function api() {
        return {
            start, stop, toggle,
            setOptions,
            getOptions: () => ({ ...CFG }),
            getLevel: (id) => getLevel(id),
            setLevel: (id, v) => setLevel(id, v),
            reset: () => initFromGraph(),
            isOn: () => !!CFG.enabled
        };
    }

    // -----------------------------
    // Register plugin
    // -----------------------------
    ONX.registerPlugin({
        id: "waterflow",
        title: "Water Flow (conservative overlay)",
        register() {
            window.ONEXUS_WATERFLOW = api();
            ONX.overlay.register("waterflow", window.ONEXUS_WATERFLOW);

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => setTimeout(hook, 0));
            } else {
                setTimeout(hook, 0);
            }
        }
    });
})();