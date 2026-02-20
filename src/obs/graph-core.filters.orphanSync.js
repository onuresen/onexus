/* ONEXUS – OrphanSync (compat shim)
   FIX: Prevent double-hiding conflicts.
   - graph-core.filters.js already handles "hide isolated nodes when edge filters active"
     via ONEXUS_FILTERS.applyHideIsolatedNodesFromVisibleEdges(). [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.tour.js)
   - This shim ONLY keeps endpoint sync (.onx-hide-end) and clears legacy orphan class.
*/
(function () {
    const cy = window.cy;
    if (!cy) return;

    const HIDE_ORPHAN = "onx-hide-orphan";
    const HIDE_ENDS = "onx-hide-end";

    function syncEdgesEnds() {
        cy.edges().forEach((e) => {
            const endpointsVisible = e.source().visible() && e.target().visible();
            if (endpointsVisible) e.removeClass(HIDE_ENDS);
            else e.addClass(HIDE_ENDS);
        });
    }

    function clearLegacyOrphanHide() {
        // If older runs left this class behind, clear it so nodes can come back
        cy.nodes().removeClass(HIDE_ORPHAN);
    }

    function reapply() {
        clearLegacyOrphanHide();
        // Prefer the canonical implementation from graph-core.filters.js
        window.ONEXUS_FILTERS?.applyHideIsolatedNodesFromVisibleEdges?.();
        // Then ensure endpoints are synced
        syncEdgesEnds();
    }

    // If the canonical filter module exists, do not wrap filter functions at all.
    // Just reapply on relevant events.
    if (!cy.___onxOrphanShimHooked) {
        cy.___onxOrphanShimHooked = true;
        cy.on("add remove layoutstop", () => setTimeout(reapply, 0));
    }

    // Boot cleanup
    setTimeout(reapply, 60);
})();