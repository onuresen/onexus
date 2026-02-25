/* =========================================================
 ONEXUS – Mobile Compatibility Layer (JS)
 Goals:
 - Detect mobile/coarse pointer and mark <html> with .onx-mobile
 - Apply sensible defaults on mobile (labels, scale)
 - Prevent floatInspector drag handler from hijacking touches
 - Make popovers reflow on orientation change
========================================================= */
(function () {
    const mqlCoarse = window.matchMedia && window.matchMedia("(pointer: coarse)");
    const mqlNarrow = window.matchMedia && window.matchMedia("(max-width: 820px)");

    function isMobile() {
        const coarse = !!(mqlCoarse && mqlCoarse.matches);
        const narrow = !!(mqlNarrow && mqlNarrow.matches);
        return coarse || narrow;
    }

    function setRootFlag() {
        const root = document.documentElement;
        root.classList.toggle("onx-mobile", isMobile());
    }

    // One-time mobile defaults (don’t fight user prefs if already set)
    function applyMobileDefaultsOnce() {
        if (!isMobile()) return;
        try {
            const k = "onexus.mobile.defaultsApplied";
            const already = localStorage.getItem(k) === "1";
            if (already) return;

            // Mobile readability: slightly smaller node size scale + hide edge labels by default
            // Keep node labels on (they’re essential for touch exploration).
            const prevScale = localStorage.getItem("onexus.scale");
            if (prevScale == null) localStorage.setItem("onexus.scale", "0.92");

            // hide edge labels: heavy clutter on small screens
            try { window.setEdgeLabelVisibility?.(false); } catch { }
            try { window.setNodeLabelVisibility?.(true); } catch { }

            localStorage.setItem(k, "1");
        } catch { /* no-op */ }
    }

    // Prevent float details drag logic from capturing touch gestures (keep close button usable)
    function disableFloatDragOnMobile() {
        if (!isMobile()) return;
        const float = document.getElementById("onxFloatDetails");
        if (!float) return;
        const handle = float.querySelector(".onx-fd-top") || float;

        // Capture-phase block to stop existing pointerdown handler from graph-ui.floatInspector.js
        // while preserving button clicks (close button etc.).
        if (!handle.__onxMobileNoDrag) {
            handle.__onxMobileNoDrag = true;
            handle.addEventListener("pointerdown", (e) => {
                // allow interacting with close button
                if (e.target && e.target.closest && e.target.closest(".onx-fd-close, button, a, input, select, textarea")) return;
                // block drag start
                e.stopImmediatePropagation();
            }, true);
            try { handle.style.cursor = "default"; } catch { }
        }
    }

    // On mobile, popovers should re-position after orientation change / resize
    function reflowOverlays() {
        try { window.cy?.resize?.(); } catch { }
        // Reposition popovers if open (layer / nodevis / tool pop)
        const pos = window.ONEXUS?.ui?.positionPopover;
        if (typeof pos !== "function") return;

        const stack = document.getElementById("onx-float-left-stack");
        const layerPop = document.getElementById("onx-layer-pop");
        const layerFab = document.getElementById("onx-layer-fab");
        if (layerPop && layerFab && layerPop.style.display !== "none") {
            pos(layerPop, { anchorEl: layerFab, stackEl: stack, mode: "stackBottom", preferRight: true, avoidMinimap: true });
        }

        const nvPop = document.getElementById("onx-nodevis-pop");
        const nvFab = document.getElementById("onx-nodevis-fab");
        if (nvPop && nvFab && nvPop.style.display !== "none") {
            pos(nvPop, { anchorEl: nvFab, stackEl: stack, mode: "stackBottom", preferRight: true, avoidMinimap: true });
        }

        const toolPop = document.getElementById("onx-tool-pop");
        const activeToolBtn = document.querySelector("#leftRail .rail-btn.active");
        if (toolPop && activeToolBtn && toolPop.style.display !== "none") {
            pos(toolPop, { anchorEl: activeToolBtn, stackEl: stack, mode: "stackBottom", preferRight: true, avoidMinimap: true });
        }
    }

    function boot() {
        setRootFlag();
        applyMobileDefaultsOnce();
        disableFloatDragOnMobile();

        // Keep overlays stable when UI shifts due to address-bar hide/show on mobile browsers
        window.addEventListener("resize", () => {
            setRootFlag();
            disableFloatDragOnMobile();
            reflowOverlays();
        });

        // Some mobile browsers fire orientationchange before resize settles
        window.addEventListener("orientationchange", () => {
            setTimeout(reflowOverlays, 80);
            setTimeout(reflowOverlays, 250);
        });

        // When graph loads, ensure float drag is disabled and cy resized
        try {
            window.ONEXUS?.bus?.on?.("graphLoaded", () => {
                disableFloatDragOnMobile();
                setTimeout(() => { try { window.cy?.resize?.(); } catch { } }, 30);
            });
        } catch { /* no-op */ }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        setTimeout(boot, 0);
    }
})();