/* =========================================
 ONEXUS Common JS (shared)
 PATCH:
 - Wrap fitView/centerView/resetView so they always call cy.resize() first.
 - Fixes “Fit stops working after a view hides #cy”.
========================================= */
(function () {
    function safeResize() {
        try { window.cy?.resize?.(); } catch { }
    }

    function wrapOnce(name) {
        const fn = window[name];
        if (typeof fn !== "function") return;
        if (fn.__onxWrapped) return;
        function wrapped(...args) {
            safeResize();
            // next paint also helps after display:none -> block
            requestAnimationFrame(() => safeResize());
            return fn.apply(this, args);
        }
        wrapped.__onxWrapped = true;
        window[name] = wrapped;
    }

    // Existing: keep cy responsive on resize
    window.addEventListener("resize", () => {
        safeResize();
        requestAnimationFrame(() => safeResize());
    });

    // Wrap navigation helpers (buttons call these)
    function bootWrap() {
        wrapOnce("fitView");
        wrapOnce("centerView");
        wrapOnce("resetView");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootWrap);
    } else {
        setTimeout(bootWrap, 0);
    }

    // Keep your existing hotkeys + undo logic (original content kept)
    document.addEventListener("keydown", (e) => {
        const tag = (e.target ?? {}).tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

        const key = String(e.key ?? "").toLowerCase();

        // View shortcuts
        if (key === "f") window.fitView && window.fitView();
        if (key === "c") window.centerView && window.centerView();
        if (key === "r") window.resetView && window.resetView();

        // Undo / Redo
        const isMac = (navigator.platform ?? "").toUpperCase().includes("MAC");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (mod && !e.shiftKey && key === "z") {
            e.preventDefault();
            window.ONEXUS_UNDO?.undo?.();
            return;
        }
        if ((mod && e.shiftKey && key === "z") || (mod && key === "y")) {
            e.preventDefault();
            window.ONEXUS_UNDO?.redo?.();
            return;
        }

        // Delete selected nodes
        if ((key === "delete" || key === "backspace") && !mod) {
            const sel = window.cy?.nodes(":selected");
            if (sel && sel.length) {
                sel.forEach((n) => window.ONEXUS_NODES?.deleteNode?.(n));
                e.preventDefault();
                return;
            }
        }

        // Alt+D => duplicate selected node
        if (e.altKey && !e.ctrlKey && !e.metaKey && key === "d") {
            const sel = window.cy?.nodes(":selected");
            if (sel && sel.length) {
                const n = sel[0];
                const newId = window.ONEXUS_NODES?.duplicateNode?.(n, { dx: 40, dy: 40, cloneEdges: false });
                if (newId) window.cy.getElementById(newId).select();
            }
        }
    });
})();