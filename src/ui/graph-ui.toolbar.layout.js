/* =========================================================
 ONEXUS – Toolbar Layout Orchestrator (Two-row)
 Row 1: tool-group selects + file input
 Row 2: iconbar + dependency graph + samples (if present)
 Safe: moves existing DOM nodes (keeps handlers)
========================================================= */
(function () {
    const $ = (id) => document.getElementById(id);

    function ensureRow(toolbar, cls) {
        let row = toolbar.querySelector(`.onx-tb-row.${cls}`);
        if (row) return row;
        row = document.createElement("div");
        row.className = `onx-tb-row ${cls}`;
        toolbar.appendChild(row);
        return row;
    }

    function moveIfExists(el, row) {
        if (!el || !row) return;
        if (el.parentElement !== row) row.appendChild(el);
    }

    function moveDepGraphIntoIconbar(toolbar) {
        const depBtn = $("btnDepGraph");
        const iconbar = toolbar.querySelector(".iconbar");
        if (!depBtn) return;
        if (!iconbar) return;

        // Ensure it looks like other icon buttons
        depBtn.classList.add("icon-btn");

        // Place it at the end of iconbar (or wherever you prefer)
        if (depBtn.parentElement !== iconbar) iconbar.appendChild(depBtn);
    }

    function boot() {
        const toolbar = $("toolbar");
        if (!toolbar) return;

        const row1 = ensureRow(toolbar, "onx-tb-controls");
        const row2 = ensureRow(toolbar, "onx-tb-actions");

        // Row 1: all tool groups (Language/Layer/View/Theme/Load)
        const groups = Array.from(toolbar.querySelectorAll(".tool-group"));
        groups.forEach(g => moveIfExists(g, row1));

        // Row 2: iconbar
        const iconbar = toolbar.querySelector(".iconbar");
        moveIfExists(iconbar, row2);

        // Move Dependency Graph button into iconbar so it doesn't create a 3rd row
        moveDepGraphIntoIconbar(toolbar);

        // Row 2: samples wrapper if created by graph-ui.samples.js
        const samplesWrap = $("onx-samples-wrap");
        moveIfExists(samplesWrap, row2);

        // Badge: do NOT move into action row (keeps it from sitting beside Samples)
        const badge = toolbar.querySelector(".badge");
        if (badge) {
            // Keep badge as a direct child of #toolbar (so CSS can pin it top-right)
            if (badge.parentElement !== toolbar) toolbar.appendChild(badge);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            boot();
            setTimeout(boot, 150);
            setTimeout(boot, 500);
        });
    } else {
        boot();
        setTimeout(boot, 150);
        setTimeout(boot, 500);
    }
})();