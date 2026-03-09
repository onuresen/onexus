/* =========================================
 ONEXUS Common JS (shared by both layouts)
 - window resize -> cy.resize()
 - keyboard shortcuts (F/C/R, Undo/Redo, delete, Alt+D)
========================================= */
(function () {
    window.addEventListener("resize", () => {
        if (window.cy && typeof window.cy.resize === "function") {
            window.cy.resize();
        }
    });

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