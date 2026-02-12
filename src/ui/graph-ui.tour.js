/* =========================================================
 ONEXUS – Guided Tour (interactive tutorial / live demo)
 - Minimal integration: injects a toolbar button + hotkey "T"
 - Highlights targets + shows instructions + waits for actions
 - Works with both index.html (right sidebar) and index_leftRail.html
 Exposes:
   window.ONEXUS_TOUR.start('basic')
   window.ONEXUS_TOUR.stop()
   window.ONEXUS_TOUR.register(name, steps)
========================================================= */
(function () {
    const TOUR_NS = (window.ONEXUS = window.ONEXUS || {});
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const state = {
        running: false,
        name: "basic",
        steps: [],
        idx: 0,
        cleanup: [],
        raf: 0,
        lastRect: null,
        lastTargetKind: null,
        pendingGate: null,
    };

    // ---------- CSS (injected) ----------
    function ensureCss() {
        if ($("#onexus-tour-css")) return;
        const css = document.createElement("style");
        css.id = "onexus-tour-css";
        css.textContent = `
      #onexus-tour-overlay{
        position:fixed; inset:0; z-index:10040;
        pointer-events:none;
      }
      #onexus-tour-spot{
        position:fixed;
        border-radius:10px;
        box-shadow: 0 0 0 9999px rgba(0,0,0,.45);
        outline: 2px solid rgba(37,99,235,.95);
        outline-offset: 2px;
        pointer-events:none;
        transition: all .14s ease;
      }
      #onexus-tour-pulse{
        position:fixed;
        border-radius:12px;
        border: 2px solid rgba(37,99,235,.65);
        pointer-events:none;
        animation: onxPulse 1.2s ease-in-out infinite;
      }
      @keyframes onxPulse {
        0% { transform: scale(1); opacity: .75; }
        70% { transform: scale(1.06); opacity: .15; }
        100% { transform: scale(1.08); opacity: 0; }
      }
      #onexus-tour-tip{
        position:fixed;
        max-width:min(420px, calc(100vw - 40px));
        background:#fff;
        color:#111;
        border: 1px solid rgba(0,0,0,.10);
        box-shadow: 0 12px 28px rgba(0,0,0,.22);
        border-radius: 12px;
        padding: 12px;
        pointer-events:auto;
        font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        font-size: 13px;
        z-index:10041;
      }
      #onexus-tour-tip .t-title{ font-weight:700; margin-bottom:6px; }
      #onexus-tour-tip .t-body{ color:#1f2937; line-height:1.45; }
      #onexus-tour-tip .t-foot{ display:flex; align-items:center; gap:8px; margin-top:10px; }
      #onexus-tour-tip .t-progress{ margin-right:auto; font-size:12px; color:#6b7280; }
      #onexus-tour-tip button{
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,.12);
        background: #fff;
        cursor: pointer;
        font-size: 12px;
      }
      #onexus-tour-tip button.primary{
        border: 0;
        background:#111827;
        color:#fff;
      }
      #onexus-tour-tip button:disabled{
        opacity:.45; cursor:not-allowed;
      }
      #onexus-tour-dismiss{
        position:fixed; right:12px; top:12px;
        background: rgba(0,0,0,.65);
        color:#fff;
        font-size:12px;
        border-radius: 999px;
        padding: 6px 10px;
        pointer-events:auto;
        z-index:10041;
        display:none;
      }
      #onexus-tour-dismiss code{ color:#fff; }
    `;
        document.head.appendChild(css);
    }

    // ---------- DOM overlay ----------
    function ensureOverlay() {
        ensureCss();
        let overlay = $("#onexus-tour-overlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = "onexus-tour-overlay";

        const spot = document.createElement("div");
        spot.id = "onexus-tour-spot";

        const pulse = document.createElement("div");
        pulse.id = "onexus-tour-pulse";

        const tip = document.createElement("div");
        tip.id = "onexus-tour-tip";
        tip.style.display = "none";
        tip.innerHTML = `
      <div class="t-title" id="onexus-tour-title"></div>
      <div class="t-body" id="onexus-tour-body"></div>
      <div class="t-foot">
        <div class="t-progress" id="onexus-tour-progress"></div>
        <button id="onexus-tour-prev">Back</button>
        <button id="onexus-tour-next" class="primary">Next</button>
        <button id="onexus-tour-skip">Skip</button>
      </div>
    `;

        const dismiss = document.createElement("div");
        dismiss.id = "onexus-tour-dismiss";
        dismiss.innerHTML = `Tour running — press <code>Esc</code> to exit`;

        overlay.appendChild(spot);
        overlay.appendChild(pulse);
        document.body.appendChild(overlay);
        document.body.appendChild(tip);
        document.body.appendChild(dismiss);

        // Buttons
        $("#onexus-tour-prev").addEventListener("click", () => prev());
        $("#onexus-tour-next").addEventListener("click", () => next(true));
        $("#onexus-tour-skip").addEventListener("click", () => stop());

        // Esc to stop
        const onEsc = (e) => { if (e.key === "Escape") stop(); };
        document.addEventListener("keydown", onEsc);
        state.cleanup.push(() => document.removeEventListener("keydown", onEsc));

        return overlay;
    }

    function showTip(title, body, idx, total, gateMode) {
        const tip = $("#onexus-tour-tip");
        $("#onexus-tour-title").textContent = title || "";
        $("#onexus-tour-body").innerHTML = body || "";
        $("#onexus-tour-progress").textContent = `${idx + 1} / ${total}`;

        const btnPrev = $("#onexus-tour-prev");
        const btnNext = $("#onexus-tour-next");
        btnPrev.disabled = idx <= 0;

        // If step is gated by action, Next is still available (manual override),
        // but we can hint via button label.
        btnNext.textContent = gateMode ? "Next (or do it)" : "Next";
        btnNext.disabled = false;

        tip.style.display = "block";
        $("#onexus-tour-dismiss").style.display = "block";
    }

    function hideTip() {
        const tip = $("#onexus-tour-tip");
        if (tip) tip.style.display = "none";
        const dismiss = $("#onexus-tour-dismiss");
        if (dismiss) dismiss.style.display = "none";
    }

    function setSpotRect(rect) {
        const pad = 10;
        const r = {
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        };
        const spot = $("#onexus-tour-spot");
        const pulse = $("#onexus-tour-pulse");
        if (!spot || !pulse) return;

        spot.style.left = `${r.left}px`;
        spot.style.top = `${r.top}px`;
        spot.style.width = `${Math.max(0, r.width)}px`;
        spot.style.height = `${Math.max(0, r.height)}px`;

        pulse.style.left = `${r.left}px`;
        pulse.style.top = `${r.top}px`;
        pulse.style.width = `${Math.max(0, r.width)}px`;
        pulse.style.height = `${Math.max(0, r.height)}px`;

        state.lastRect = r;
    }

    function placeTipNear(rect) {
        const tip = $("#onexus-tour-tip");
        if (!tip) return;

        const margin = 12;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Default: right side of rect
        tip.style.left = "0px";
        tip.style.top = "0px";

        // Measure with display block
        tip.style.visibility = "hidden";
        tip.style.display = "block";
        const tr = tip.getBoundingClientRect();
        tip.style.visibility = "visible";

        let left = rect.left + rect.width + margin;
        let top = rect.top;

        // If overflow right, place left of rect
        if (left + tr.width > vw - margin) left = rect.left - tr.width - margin;

        // If still overflow, clamp
        left = clamp(left, margin, vw - tr.width - margin);

        // Vertical clamp
        if (top + tr.height > vh - margin) top = vh - tr.height - margin;
        top = clamp(top, margin, vh - tr.height - margin);

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    // ---------- Target resolution ----------
    function isVisibleEl(el) {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function getRectForTarget(target) {
        // Target can be:
        // 1) string selector
        // 2) element
        // 3) function returning selector/element or { kind:'cyNode', node }
        if (!target) return null;

        const cy = window.cy;

        const resolve = (t) => (typeof t === "function" ? t() : t);
        const t = resolve(target);

        if (!t) return null;

        // Cytoscape node target
        if (typeof t === "object" && t.kind === "cyNode" && t.node) {
            const n = t.node;
            try {
                // Ensure it's in view
                if (cy && n && n.nonempty && n.nonempty()) {
                    const bb = (typeof n.renderedBoundingBox === "function") ? n.renderedBoundingBox() : null;
                    if (bb && Number.isFinite(bb.w) && Number.isFinite(bb.h)) {
                        return { left: bb.x1, top: bb.y1, width: bb.w, height: bb.h, _kind: "cyNode" };
                    }
                    // Fallback: renderedPosition + size
                    const rp = n.renderedPosition ? n.renderedPosition() : null;
                    const w = parseFloat(n.style("width")) || 60;
                    const h = parseFloat(n.style("height")) || 60;
                    if (rp) return { left: rp.x - w / 2, top: rp.y - h / 2, width: w, height: h, _kind: "cyNode" };
                }
            } catch { /* noop */ }
            return null;
        }

        // DOM selector
        if (typeof t === "string") {
            const el = $(t);
            if (!isVisibleEl(el)) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height, _kind: "dom" };
        }

        // DOM element
        if (t instanceof Element) {
            if (!isVisibleEl(t)) return null;
            const r = t.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height, _kind: "dom" };
        }

        return null;
    }

    // ---------- Gate / action waiting ----------
    function clearGate() {
        if (state.pendingGate && typeof state.pendingGate === "function") {
            try { state.pendingGate(); } catch { }
        }
        state.pendingGate = null;
    }

    function waitFor(step, onSatisfied) {
        clearGate();
        if (!step || !step.waitFor) return;

        const wf = step.waitFor;
        const cy = window.cy;

        // waitFor: { dom: { selector, event }, once=true }
        if (wf.dom && wf.dom.selector) {
            const sel = wf.dom.selector;
            const ev = wf.dom.event || "click";
            const root = wf.dom.root ? $(wf.dom.root) : document;
            const handler = (e) => {
                const hit = e.target && (e.target.matches?.(sel) || e.target.closest?.(sel));
                if (!hit) return;
                cleanup();
                onSatisfied();
            };
            root.addEventListener(ev, handler, true);
            const cleanup = () => root.removeEventListener(ev, handler, true);
            state.pendingGate = cleanup;
            return;
        }

        // waitFor: { cy: { type:'tap', selector:'node'|'edge'|'canvas' } }
        if (wf.cy && cy) {
            const type = wf.cy.type || "tap";
            const sel = wf.cy.selector || "node";
            const handler = (evt) => {
                if (!state.running) return;
                if (sel === "canvas") {
                    if (evt.target === cy) { cleanup(); onSatisfied(); }
                    return;
                }
                // cytoscape selector
                if (evt.target && evt.target !== cy && evt.target.is && evt.target.is(sel)) {
                    cleanup();
                    onSatisfied(evt.target);
                }
            };
            cy.on(type, handler);
            const cleanup = () => { try { cy.off(type, handler); } catch { } };
            state.pendingGate = cleanup;
            return;
        }

        // waitFor: function returning boolean
        if (typeof wf === "function") {
            let stop = false;
            const tick = () => {
                if (stop || !state.running) return;
                let ok = false;
                try { ok = !!wf(); } catch { ok = false; }
                if (ok) {
                    stop = true;
                    state.pendingGate = null;
                    onSatisfied();
                    return;
                }
                requestAnimationFrame(tick);
            };
            state.pendingGate = () => { stop = true; };
            requestAnimationFrame(tick);
            return;
        }
    }

    // ---------- Step runner ----------
    function runStep(i) {
        if (!state.running) return;
        if (!state.steps || !state.steps.length) return;

        clearGate();

        state.idx = clamp(i, 0, state.steps.length - 1);
        const step = state.steps[state.idx];

        // Skip step if target missing and skipIfMissing not explicitly false
        const rect = getRectForTarget(step.target);
        if (!rect && step.skipIfMissing !== false) {
            // try next
            if (state.idx < state.steps.length - 1) return runStep(state.idx + 1);
            // else stop
            return stop();
        }

        // optional enter hook (can adjust layout, open drawer, etc.)
        try { step.onEnter && step.onEnter(); } catch { }

        // re-evaluate rect after onEnter
        const rect2 = getRectForTarget(step.target) || rect;

        // if still missing, skip
        if (!rect2 && step.skipIfMissing !== false) {
            if (state.idx < state.steps.length - 1) return runStep(state.idx + 1);
            return stop();
        }

        ensureOverlay();

        // show content
        showTip(step.title, step.body, state.idx, state.steps.length, !!step.waitFor);

        // spot + tip position
        if (rect2) {
            setSpotRect(rect2);
            placeTipNear({ left: rect2.left, top: rect2.top, width: rect2.width, height: rect2.height });
        }

        // keep position synced (resize/scroll/zoom/pan)
        startSyncLoop(step);

        // gate progression (auto-advance on expected action)
        if (step.waitFor) {
            waitFor(step, () => {
                if (!state.running) return;
                next(false);
            });
        }
    }

    function startSyncLoop(step) {
        cancelSyncLoop();
        const cy = window.cy;

        const sync = () => {
            if (!state.running) return;
            const rect = getRectForTarget(step.target);
            if (rect) {
                setSpotRect(rect);
                placeTipNear({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            }
            state.raf = requestAnimationFrame(sync);
        };
        state.raf = requestAnimationFrame(sync);

        // Also listen to cy pan/zoom for faster response
        if (cy && !cy.__tourHooked) {
            cy.__tourHooked = true;
            const onPanZoom = () => { /* loop handles it */ };
            cy.on("pan zoom resize", onPanZoom);
            state.cleanup.push(() => { try { cy.off("pan zoom resize", onPanZoom); } catch { } });
        }
    }

    function cancelSyncLoop() {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
    }

    // ---------- API ----------
    function start(name = "basic") {
        // if already running, restart
        stop(false);

        const pack = tours[name] || tours.basic;
        state.name = name;
        state.steps = (pack && pack.steps) ? pack.steps : [];
        state.idx = 0;
        state.running = true;

        ensureOverlay();
        runStep(0);

        // toast
        window.showTransientMessage?.("Tutorial started (Esc to exit, T to restart)");
    }

    function stop(showToast = true) {
        if (!state.running && !$("#onexus-tour-overlay")) return;
        state.running = false;

        clearGate();
        cancelSyncLoop();

        hideTip();

        const overlay = $("#onexus-tour-overlay");
        if (overlay) overlay.remove();

        const tip = $("#onexus-tour-tip");
        if (tip) tip.remove();

        const dismiss = $("#onexus-tour-dismiss");
        if (dismiss) dismiss.remove();

        // run cleanup hooks
        const c = state.cleanup.splice(0, state.cleanup.length);
        c.forEach(fn => { try { fn(); } catch { } });

        if (showToast) window.showTransientMessage?.("Tutorial ended");
    }

    function next(fromButton) {
        if (!state.running) return;
        // manual advance cancels gate
        if (fromButton) clearGate();
        const ni = state.idx + 1;
        if (ni >= state.steps.length) return stop();
        runStep(ni);
    }

    function prev() {
        if (!state.running) return;
        clearGate();
        const pi = state.idx - 1;
        runStep(pi);
    }

    // ---------- Tours registry ----------
    const tours = {};

    function register(name, steps) {
        tours[name] = { steps: Array.isArray(steps) ? steps : [] };
    }

    // ---------- Helpers for both layouts ----------
    function openLeftDrawerPanel(panelId) {
        // leftRail layout only
        const drawer = $("#leftDrawer");
        const body = $("#drawerBody");
        const title = $("#drawerTitle");
        const closeBtn = $("#drawerClose");
        if (!drawer || !body) return false;

        // show drawer
        drawer.classList?.add("open");
        drawer.style.display = "block";

        // hide panels
        $$(".drawer-panel", body).forEach(p => p.classList.remove("active"));
        const panel = $("#" + panelId);
        if (panel) panel.classList.add("active");

        if (title && panel) {
            const map = { panelFilter: "Filter", panelStyle: "Style", panelAnim: "Animation" };
            title.textContent = map[panelId] || "Panel";
        }

        // attach close once
        if (closeBtn && !closeBtn.__tourHooked) {
            closeBtn.__tourHooked = true;
            closeBtn.addEventListener("click", () => {
                drawer.classList.remove("open");
                drawer.style.display = "none";
            });
        }
        return true;
    }

    function findFocusSlider() {
        // right sidebar layout: focus slider is near #depthLabel in a div
        const depthLabel = $("#depthLabel");
        if (depthLabel) {
            const host = depthLabel.closest("div");
            const input = host ? $("input[type='range']", host) : null;
            if (input) return input;
        }
        // leftRail layout: same id, but inside panelFilter
        const inPanel = $("#panelFilter #depthLabel");
        if (inPanel) {
            const host = inPanel.closest("div");
            const input = host ? $("input[type='range']", host) : null;
            if (input) return input;
        }
        return null;
    }

    function findLensSystemButton() {
        // right sidebar
        let btn = $("button.flat[onclick*=\"filterByDimension('System')\"]");
        if (btn) return btn;

        // leftRail: ensure panel open then find
        btn = $("#panelFilter button.flat[onclick*=\"filterByDimension('System')\"]");
        return btn;
    }

    // pick a visible node to highlight (if graph loaded)
    function pickAnyVisibleNode() {
        const cy = window.cy;
        if (!cy) return null;
        const n = cy.nodes(":visible")[0];
        if (!n || !n.nonempty?.()) return null;
        return n;
    }

    // ---------- Default “basic” tour ----------
    register("basic", [
        {
            id: "load",
            title: "Load a graph",
            body: "Click <b>Load</b> and choose a <code>.json</code> / <code>.csv</code> / <code>.ifc</code> to import.",
            target: "#fileInput",
            waitFor: { dom: { selector: "#fileInput", event: "change" } }
        },
        {
            id: "fit",
            title: "Navigate the view",
            body: "Use <b>Fit</b> to frame the graph. (Hotkey: <code>F</code>)",
            target: () => $("button[aria-label='Fit']") || $("button[title*='Fit']") || $("#toolbar"),
            waitFor: { dom: { selector: "button[aria-label='Fit'],button[title*='Fit']", event: "click" } }
        },
        {
            id: "selectNode",
            title: "Select a node",
            body: "Click any node to see its details. (Tip: Shift+Click applies focus immediately.)",
            target: () => {
                const n = pickAnyVisibleNode();
                if (n) {
                    // center on it so the highlight lands on-screen
                    try { window.cy.center(n); } catch { }
                    return { kind: "cyNode", node: n };
                }
                return $("#canvas-wrap") || $("#cy");
            },
            waitFor: { cy: { type: "tap", selector: "node" } }
        },
        {
            id: "details",
            title: "Inspect details",
            body: "Details update here when you click nodes/edges.",
            target: () => $("#details") || $("#onxFloatDetails") || $("#onxFloatDetailsBody"),
            skipIfMissing: true
        },
        {
            id: "focusDepth",
            title: "Focus (N-hop)",
            body: "Adjust focus depth and <b>double-click a node</b> to apply fading beyond N hops.",
            target: () => findFocusSlider() || $("#depthLabel") || $("#sidebar") || $("#leftDrawer") || $("#toolbar"),
            waitFor: { cy: { type: "tap", selector: "node" } } // user taps again; they’ll usually try double-tap
        },
        {
            id: "categoryFilter",
            title: "Filter by category",
            body: "Use category filter to show/hide node groups (edges sync automatically).",
            target: "#categoryFilter",
            waitFor: { dom: { selector: "#categoryFilter", event: "change" } }
        },
        {
            id: "lens",
            title: "Lens (semantic dimension)",
            body: "Use Lens buttons to filter edges by semantic dimension (System / Spatial / Responsibility / Vendor).",
            target: () => {
                // leftRail needs panel open
                if ($("#leftDrawer")) openLeftDrawerPanel("panelFilter");
                return findLensSystemButton() || $("#legend") || $("#sidebar") || $("#leftDrawer");
            },
            waitFor: { dom: { selector: "button.flat[onclick*=\"filterByDimension('System')\"],#panelFilter button.flat[onclick*=\"filterByDimension('System')\"]", event: "click" } }
        },
        {
            id: "legend",
            title: "Relationship legend",
            body: "Click a legend item to toggle relationship-type filtering.",
            target: "#legend",
            waitFor: { dom: { selector: "#legend .legend-item", event: "click" } },
            skipIfMissing: true
        },
        {
            id: "contextMenu",
            title: "Context menu",
            body: "Right-click a node to open context actions (edit, duplicate, connect, path, export).",
            target: () => $("#cy") || $("#canvas-wrap"),
            waitFor: { dom: { selector: "#cy-context-menu", event: "mouseenter", root: "body" } },
            skipIfMissing: true
        },
        {
            id: "connect",
            title: "Create a relation (fast)",
            body: "Tip: <b>Alt+Drag</b> from a node to another node to open the relation wizard.",
            target: () => $("#cy") || $("#canvas-wrap"),
            // gate: when the link wizard opens, move on
            waitFor: () => !!$("#onexus-edge-wizard"),
            skipIfMissing: true
        },
        {
            id: "export",
            title: "Export",
            body: "Use the toolbar icons to export <b>PNG / SVG / JSON / CSV / Layout</b>.",
            target: () => $(".iconbar") || $("#toolbar"),
            skipIfMissing: true
        }
    ]);

    // ---------- Toolbar button injection + hotkey ----------
    function ensureTourButton() {
        const bar = $(".iconbar") || $("#toolbar");
        if (!bar) return;

        if ($("#btnTour")) return;

        const btn = document.createElement("button");
        btn.className = "icon-btn";
        btn.id = "btnTour";
        btn.title = "Tutorial (T)";
        btn.setAttribute("aria-label", "Tutorial");

        // simple "play" icon
        btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 8l6 4-6 4V8z"></path>
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path>
      </svg>
    `;
        btn.addEventListener("click", () => start("basic"));

        // place near badge if possible; otherwise append
        const badge = $(".badge", bar) || $(".badge");
        if (badge && badge.parentElement) {
            badge.parentElement.insertBefore(btn, badge);
        } else {
            bar.appendChild(btn);
        }
    }

    function bindHotkeys() {
        if (bindHotkeys.__done) return;
        bindHotkeys.__done = true;

        document.addEventListener("keydown", (e) => {
            const tag = (e.target && e.target.tagName) || "";
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

            const k = (e.key || "").toLowerCase();
            if (k === "t") {
                e.preventDefault();
                start("basic");
            }
        });
    }

    // ---------- Expose ----------
    window.ONEXUS_TOUR = {
        start,
        stop,
        next,
        prev,
        register,
        isRunning: () => state.running,
        current: () => ({ name: state.name, idx: state.idx, total: state.steps.length })
    };

    // boot
    window.addEventListener("DOMContentLoaded", () => {
        ensureTourButton();
        bindHotkeys();
    });
    setTimeout(() => { ensureTourButton(); bindHotkeys(); }, 120);

})();