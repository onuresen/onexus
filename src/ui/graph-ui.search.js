// ONEXUS – Node Search
// Live filters nodes by displayLabel; Enter cycles matches, Escape clears.
(function () {
    const DEBOUNCE_MS = 150;

    let matches = null;  // cy collection
    let matchIdx = 0;
    let debounceTimer = null;

    const getInput = () => document.getElementById("onxSearch");
    const getCountEl = () => document.getElementById("onxSearchCount");

    function clearSearch() {
        matches = null;
        matchIdx = 0;
        const inp = getInput();
        if (inp && inp.value) inp.value = "";
        const cnt = getCountEl();
        if (cnt) cnt.textContent = "";
        try { window.cy?.nodes().removeClass("search-match search-dim"); } catch { }
    }

    function applySearch(term) {
        const cy = window.cy;
        if (!cy) return;

        cy.nodes().removeClass("search-match search-dim");

        if (!term) {
            matches = null;
            matchIdx = 0;
            const cnt = getCountEl();
            if (cnt) cnt.textContent = "";
            return;
        }

        const lc = term.toLowerCase();
        matches = cy.nodes().filter(n => {
            const lbl = String(n.data("displayLabel") ?? n.data("id") ?? "").toLowerCase();
            return lbl.includes(lc);
        });
        matchIdx = 0;

        const cnt = getCountEl();
        if (cnt) cnt.textContent = matches.length ? `${matches.length} found` : "no match";

        if (!matches.length) return;

        cy.nodes().not(matches).addClass("search-dim");
        matches.addClass("search-match");
        cy.fit(matches, 60);
    }

    function cycleToNext() {
        if (!matches || !matches.length) return;
        matchIdx = (matchIdx + 1) % matches.length;
        const node = matches[matchIdx];
        if (node) window.cy?.animate({ center: { eles: node }, duration: 180 });
    }

    function injectCyStyles() {
        const cy = window.cy;
        if (!cy || cy.__searchStylesInjected) return;
        cy.__searchStylesInjected = true;
        try {
            cy.style()
                .selector("node.search-match")
                .style({ "border-width": 3, "border-color": "#f59e0b", "border-opacity": 1 })
                .selector("node.search-dim")
                .style({ opacity: 0.2 })
                .update();
        } catch { }
    }

    function boot() {
        const inp = getInput();
        if (!inp) return;

        const tryInject = () => {
            if (window.cy) injectCyStyles();
            else setTimeout(tryInject, 200);
        };
        tryInject();

        inp.addEventListener("input", () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => applySearch(inp.value.trim()), DEBOUNCE_MS);
        });

        inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); cycleToNext(); }
            if (e.key === "Escape") { e.preventDefault(); clearSearch(); inp.blur(); }
        });

        try { window.ONEXUS?.bus?.on?.("graphLoaded", clearSearch); } catch { }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }

    window.ONEXUS_SEARCH = { clear: clearSearch, apply: applySearch };
})();
