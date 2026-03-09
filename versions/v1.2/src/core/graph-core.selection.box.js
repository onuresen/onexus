/* =========================================================
 ONEXUS – Box (Rectangle) Selection for Nodes + Edges
 - Shift + Drag on canvas: draw selection rectangle
 - Shift + Ctrl/Cmd + Drag: additive selection (keeps existing selection)
 - Selects: nodes intersecting box + edges intersecting box OR edges whose both endpoints are selected
 Safe:
 - Does not change existing click behaviors
 - Does not require Cytoscape extensions
========================================================= */
(function () {
    const cy = window.cy;
    if (!cy) return;

    const host = cy.container?.();
    if (!host) return;

    // Avoid starting selection when dragging on these UI overlays
    const UI_BLOCK_SELECTORS = [
        "#toolbar",
        "#leftDrawer",
        "#onx-tool-pop",
        "#onx-layer-pop",
        "#onx-nodevis-pop",
        "#onx-toolbar-more",
        "#cy-context-menu",
        "#onxFloatDetails"
    ];

    function isBlockedTarget(t) {
        try {
            return UI_BLOCK_SELECTORS.some(sel => t?.closest?.(sel));
        } catch {
            return false;
        }
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function ensureOverlay() {
        let overlay = document.getElementById("onx-boxsel-overlay");
        if (overlay) return overlay;

        // host is #cy container; ensure relative so overlay fits
        try {
            const cs = getComputedStyle(host);
            if (cs.position === "static") host.style.position = "relative";
        } catch { /* noop */ }

        overlay = document.createElement("div");
        overlay.id = "onx-boxsel-overlay";
        Object.assign(overlay.style, {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            zIndex: "10020"
        });

        const box = document.createElement("div");
        box.id = "onx-boxsel-rect";
        Object.assign(box.style, {
            position: "absolute",
            display: "none",
            border: "2px dashed rgba(37,99,235,0.85)",
            background: "rgba(37,99,235,0.12)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.45) inset",
            borderRadius: "6px"
        });

        overlay.appendChild(box);
        host.appendChild(overlay);
        return overlay;
    }

    function getRectEl() {
        ensureOverlay();
        return document.getElementById("onx-boxsel-rect");
    }

    function rectFromPoints(x0, y0, x1, y1) {
        const left = Math.min(x0, x1);
        const top = Math.min(y0, y1);
        const right = Math.max(x0, x1);
        const bottom = Math.max(y0, y1);
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    function intersects(bb, r) {
        // bb: {x1,y1,x2,y2,w,h} from renderedBoundingBox()
        if (!bb) return false;
        const x1 = bb.x1 ?? bb.x ?? 0;
        const y1 = bb.y1 ?? bb.y ?? 0;
        const x2 = bb.x2 ?? (x1 + (bb.w ?? bb.width ?? 0));
        const y2 = bb.y2 ?? (y1 + (bb.h ?? bb.height ?? 0));
        return !(x2 < r.left || x1 > r.right || y2 < r.top || y1 > r.bottom);
    }

    function renderedBoxFor(ele) {
        try {
            if (typeof ele.renderedBoundingBox === "function") return ele.renderedBoundingBox();
        } catch { /* noop */ }
        try {
            // fallback: position + size for nodes
            if (ele.isNode?.()) {
                const p = ele.renderedPosition?.() ?? ele.position?.();
                const w = parseFloat(ele.style?.("width")) || 60;
                const h = parseFloat(ele.style?.("height")) || 60;
                if (p) {
                    return { x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2, w, h };
                }
            }
            // fallback: edge bbox is hard without renderedBoundingBox
        } catch { /* noop */ }
        return null;
    }

    function setRectVisual(r) {
        const box = getRectEl();
        if (!box) return;
        box.style.display = "block";
        box.style.left = `${Math.round(r.left)}px`;
        box.style.top = `${Math.round(r.top)}px`;
        box.style.width = `${Math.round(r.width)}px`;
        box.style.height = `${Math.round(r.height)}px`;
    }

    function hideRectVisual() {
        const box = getRectEl();
        if (box) box.style.display = "none";
    }

    function selectByRect(r, additive) {
        // If very small drag, ignore (prevents accidental clicks)
        if (r.width < 6 && r.height < 6) return;

        if (!additive) {
            try { cy.elements().unselect(); } catch { /* noop */ }
        }

        const nodes = cy.nodes(":visible").filter(n => intersects(renderedBoxFor(n), r));
        nodes.select();

        // Edges:
        //  A) edges whose rendered bbox intersects the rect
        //  B) edges whose BOTH endpoints are selected (makes "internal edges" selected even if bbox misses)
        const nodeIds = new Set(nodes.map(n => n.id()));

        const edgesA = cy.edges(":visible").filter(e => intersects(renderedBoxFor(e), r));
        const edgesB = cy.edges(":visible").filter(e => nodeIds.has(e.data("source")) && nodeIds.has(e.data("target")));
        edgesA.union(edgesB).select();

        // Optional: toast count (kept subtle)
        try {
            window.showTransientMessage?.(`Selected: ${nodes.length} nodes, ${edgesA.union(edgesB).length} edges`, 1200);
        } catch { /* noop */ }
    }

    // -----------------------------
    // Pointer handling
    // -----------------------------
    let active = false;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let pointerId = null;

    function pointFromEvent(e) {
        const rect = host.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, rect.width);
        const y = clamp(e.clientY - rect.top, 0, rect.height);
        return { x, y };
    }

    function onDown(e) {
        // Only left button
        if (e.button !== 0) return;

        // Must hold Shift for box selection
        if (!e.shiftKey) return;

        // Don't start if clicking on UI overlays
        if (isBlockedTarget(e.target)) return;

        // Only start when pointer is over Cytoscape canvas container
        // (host contains the canvas; if event bubbles from inside, it's ok)
        active = true;
        pointerId = e.pointerId;

        const p = pointFromEvent(e);
        start = p;
        last = p;

        setRectVisual(rectFromPoints(start.x, start.y, last.x, last.y));

        try { host.setPointerCapture?.(pointerId); } catch { /* noop */ }
        e.preventDefault();
        e.stopPropagation();
    }

    function onMove(e) {
        if (!active) return;
        if (pointerId != null && e.pointerId !== pointerId) return;

        const p = pointFromEvent(e);
        last = p;

        setRectVisual(rectFromPoints(start.x, start.y, last.x, last.y));
        e.preventDefault();
    }

    function onUp(e) {
        if (!active) return;
        if (pointerId != null && e.pointerId !== pointerId) return;

        active = false;

        const additive = !!(e.ctrlKey || e.metaKey); // Shift+Ctrl/Cmd = additive
        const r = rectFromPoints(start.x, start.y, last.x, last.y);
        hideRectVisual();

        try { host.releasePointerCapture?.(pointerId); } catch { /* noop */ }
        pointerId = null;

        selectByRect(r, additive);
        e.preventDefault();
        e.stopPropagation();
    }

    // Attach (capture phase reduces interference)
    if (!host.__onxBoxSelHooked) {
        host.__onxBoxSelHooked = true;

        host.addEventListener("pointerdown", onDown, true);
        host.addEventListener("pointermove", onMove, true);
        host.addEventListener("pointerup", onUp, true);
        host.addEventListener("pointercancel", onUp, true);
        host.addEventListener("lostpointercapture", (e) => {
            if (!active) return;
            // Treat as cancel
            active = false;
            pointerId = null;
            hideRectVisual();
        }, true);
    }
})();