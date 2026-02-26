/* =========================================================
 ONEXUS – Toolbar Layout Orchestrator (Two-row)
 Row 1: tool-group selects + file input
 Row 2: iconbar + dependency graph + samples + server persistence buttons
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

    function moveIntoIconbar(btnId) {
        const btn = $(btnId);
        const toolbar = $("toolbar");
        if (!toolbar || !btn) return;

        // Find the iconbar (best target)
        const iconbar = toolbar.querySelector(".iconbar");
        if (!iconbar) return;

        // Ensure consistent styling
        btn.classList.add("icon-btn");

        // Move into iconbar
        if (btn.parentElement !== iconbar) iconbar.appendChild(btn);
    }

    function boot() {
        const toolbar = $("toolbar");
        if (!toolbar) return;

        const row1 = ensureRow(toolbar, "onx-tb-controls");
        const row2 = ensureRow(toolbar, "onx-tb-actions");

        // Row 1: all tool groups (Language/Layer/View/Theme/Load)
        const groups = Array.from(toolbar.querySelectorAll(".tool-group"));
        groups.forEach((g) => moveIfExists(g, row1));

        // Row 2: iconbar
        const iconbar = toolbar.querySelector(".iconbar");
        moveIfExists(iconbar, row2);

        // Keep special buttons INSIDE iconbar so they never create a 3rd row
        moveIntoIconbar("btnDepGraph");
        moveIntoIconbar("btnSaveServer");
        moveIntoIconbar("btnOpenServer");

        // Row 2: samples wrapper if created by graph-ui.samples.js
        const samplesWrap = $("onx-samples-wrap");
        moveIfExists(samplesWrap, row2);

        // Badge: keep pinned to toolbar root (top-right)
        const badge = toolbar.querySelector(".badge");
        if (badge && badge.parentElement !== toolbar) toolbar.appendChild(badge);
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