/* =========================================
   ONEXUS Common JS (shared by both layouts)
   - window resize -> cy.resize()
   - keyboard shortcuts (F/C/R, Undo/Redo, delete, Alt+D)
   Safe: no behavior change.
========================================= */

(function () {
    // Resize
    window.addEventListener("resize", () => {
        if (window.cy && typeof window.cy.resize === "function") {
            window.cy.resize();
        }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        const tag = (e.target ?? {}).tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

        const key = (e.key ?? "").toLowerCase();

        // View shortcuts
        switch (key) {
            case "f": window.fitView && fitView(); break;
            case "c": window.centerView && centerView(); break;
            case "r": window.resetView && resetView(); break;
        }

        // Undo / Redo
        const isMac = navigator.platform?.toUpperCase().includes("MAC");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        // Undo: Cmd/Ctrl+Z
        if (mod && !e.shiftKey && key === "z") {
            e.preventDefault();
            window.ONEXUS_UNDO?.undo?.();
            return;
        }

        // Redo: Shift+Cmd/Ctrl+Z OR Cmd/Ctrl+Y
        if ((mod && e.shiftKey && key === "z") || (mod && key === "y")) {
            e.preventDefault();
            window.ONEXUS_UNDO?.redo?.();
            return;
        }

        // Delete selected nodes
        if ((key === "delete" || key === "backspace") && !mod) {
            const sel = window.cy?.nodes(":selected");
            if (sel && sel.length) {
                sel.forEach((n) => window.ONEXUS_NODES?.deleteNode(n));
                e.preventDefault();
                return;
            }
        }

        // Alt+D => duplicate selected node
        if (e.altKey && !e.ctrlKey && !e.metaKey && key === "d") {
            const sel = window.cy?.nodes(":selected");
            if (sel && sel.length) {
                const n = sel[0];
                const newId = window.ONEXUS_NODES?.duplicateNode(n, { dx: 40, dy: 40, cloneEdges: false });
                if (newId) window.cy.getElementById(newId).select();
            }
        }
    });
})();