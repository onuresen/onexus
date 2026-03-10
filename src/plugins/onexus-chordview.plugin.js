/* =========================================================
 ONEXUS Plugin — Chord View (D3 edge-bundling)
 - Adds "Chord" view as a lens on current visible Cytoscape graph
 - Subset mode default: nodeType in ["Solution","Capability"]
 - Click chord node => selects cy node + updates details
 - ESC clears; ENTER jumps back to graph & fits selected node
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    const LOG = window.ONEXUS_LOG || console;
    const bus = ONX.bus;

    const CFG = {
        id: "chord",
        title: "Chord",
        d3Url: "https://d3js.org/d3.v7.min.js",
        cssUrl: "./src/views/chord/styles.css",
        chartUrl: "./src/views/chord/circle-chart.js",
        subsetNodeTypes: ["Solution", "Capability", "Format", "Standard"],
        persistKey: "onexus.viewMode"
    };

    function $(id) { return document.getElementById(id); }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Failed to load script: " + src));
            document.head.appendChild(s);
        });
    }

    async function loadCssOnce(url, id) {
        if (document.getElementById(id)) return;
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error("Failed to load CSS: " + url);
        const css = await res.text();
        const st = document.createElement("style");
        st.id = id;
        st.textContent = css;
        document.head.appendChild(st);
    }

    async function ensureDeps() {
        if (!window.d3) await loadScript(CFG.d3Url);
        await loadCssOnce(CFG.cssUrl, "onx-chord-css");
        if (!window.ONEXUS_CIRCLE_CHART) await loadScript(CFG.chartUrl);
    }

    function ensureHost() {
        const wrap = $("canvas-wrap") || $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";

        let host = $("onx-chord-host");
        if (!host) {
            host = document.createElement("div");
            host.id = "onx-chord-host";
            host.innerHTML = `<svg id="onxChordSvg" aria-label="Chord view"></svg>`;
            wrap.appendChild(host);
        }
        return host;
    }

    function ensureToolbarBtn() {
        const toolbar = $("toolbar");
        if (!toolbar) return null;

        // Prefer iconbar if present
        const iconbar = toolbar.querySelector(".iconbar");
        const row = iconbar || toolbar.querySelector(".onx-tb-row.onx-tb-actions") || toolbar;

        let btn = $("btnViewChord");
        if (!btn) {
            btn = document.createElement("button");
            btn.id = "btnViewChord";
            btn.className = "icon-btn";
            btn.title = "Chord View";
            btn.setAttribute("aria-label", "Chord View");
            btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8"></circle>
          <path d="M7 13c3-4 7-4 10 0"></path>
        </svg>`;
            row.appendChild(btn);
        }
        return btn;
    }

    function readViewMode() {
        try { return localStorage.getItem(CFG.persistKey) || "graph"; } catch { return "graph"; }
    }
    function writeViewMode(v) {
        try { localStorage.setItem(CFG.persistKey, v); } catch { }
    }

    function setGraphVisible(isGraph) {
        const cyEl = $("cy");
        const mm = $("minimap");
        if (cyEl) {
            cyEl.style.display = isGraph ? "block" : "none";
            cyEl.style.pointerEvents = isGraph ? "auto" : "none";
        }
        if (mm) {
            mm.style.display = isGraph ? "block" : "none";
        }
    }

    function snapshotVisibleSubgraph(cy, subsetNodeTypes) {
        const allow = new Set((subsetNodeTypes || []).map(String));

        // Visible nodes/edges come from existing ONEXUS filters/layers
        const visNodes = cy.nodes(":visible")
            .map(n => ({ data: { ...n.data() } }))
            .filter(nw => allow.size === 0 || allow.has(String(nw.data.nodeType || "")));

        const allowedIds = new Set(visNodes.map(nw => String(nw.data.id)));

        // Only edges whose endpoints exist in the subset snapshot
        const visEdges = cy.edges(":visible")
            .filter(e => allowedIds.has(String(e.data("source"))) && allowedIds.has(String(e.data("target"))))
            .map(e => ({ data: { ...e.data() } }));

        // Preserve arcOrder if graph meta has it (optional)
        const arcOrder = (window.__onexus_meta?.view?.arcOrder) || (window.__onexus_meta?.arcOrder) || null;

        return {
            meta: window.__onexus_meta || window.___onexus_meta || {},
            view: arcOrder ? { arcOrder } : {},
            elements: { nodes: visNodes, edges: visEdges }
        };
    }

    // Simple debounce
    function debounce(fn, ms = 120) {
        let t = 0;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    // ------------------------------
    // View runtime
    // ------------------------------
    const runtime = {
        mode: "graph",
        chart: null,
        pinnedOnexusId: null,
        internalSelection: false
    };

    async function mountChord() {
        const cy = window.cy;
        if (!cy) return;

        await ensureDeps();
        const host = ensureHost();
        if (!host) return;

        host.classList.add("active");
        setGraphVisible(false);

        if (!runtime.chart) {
            const svg = $("onxChordSvg");
            runtime.chart = window.ONEXUS_CIRCLE_CHART.create(svg, {
                language: window.___onexus_state?.language || window.__onexus_state?.language || "en",
                nodeTypeAllow: CFG.subsetNodeTypes,
                onPinChanged: (onexusId) => {
                    runtime.pinnedOnexusId = onexusId || null;
                    // Mirror selection to Cytoscape + update details
                    if (!onexusId) {
                        runtime.internalSelection = true;
                        try { cy.elements().unselect(); } catch { }
                        runtime.internalSelection = false;
                        return;
                    }
                    const node = cy.getElementById(onexusId);
                    if (node && node.nonempty && node.nonempty()) {
                        runtime.internalSelection = true;
                        try { cy.elements().unselect(); node.select(); } catch { }
                        runtime.internalSelection = false;
                        try { window.updateDetailsForNode?.(node); } catch { }
                    }
                }
            });
        }

        refreshChord();
    }

    function unmountChord() {
        const host = $("onx-chord-host");
        if (host) host.classList.remove("active");
        setGraphVisible(true);
    }

    const refreshChord = debounce(() => {
        const cy = window.cy;
        if (!cy || !runtime.chart) return;
        const graph = snapshotVisibleSubgraph(cy, CFG.subsetNodeTypes);

        runtime.chart.setGraph(graph, {
            language: window.___onexus_state?.language || window.__onexus_state?.language || "en",
            nodeTypeAllow: CFG.subsetNodeTypes
        });

        // Re-apply pin from Cytoscape selection if chord just mounted
        const sel = cy.nodes(":selected");
        if (sel && sel.length && !runtime.pinnedOnexusId) {
            const id = sel[0].id();
            runtime.pinnedOnexusId = id;
            runtime.chart.setPinnedOnexusId(id);
        } else if (runtime.pinnedOnexusId) {
            runtime.chart.setPinnedOnexusId(runtime.pinnedOnexusId);
        }
    }, 140);

    function setMode(mode) {
        runtime.mode = (mode === "chord") ? "chord" : "graph";
        writeViewMode(runtime.mode);

        if (runtime.mode === "chord") mountChord();
        else unmountChord();
    }

    function toggleMode() {
        setMode(runtime.mode === "chord" ? "graph" : "chord");
    }

    // ------------------------------
    // Selection sync: Graph -> Chord
    // ------------------------------
    function hookSelectionSync() {
        const cy = window.cy;
        if (!cy || cy.__onxChordSelHooked) return;
        cy.__onxChordSelHooked = true;

        cy.on("select unselect", "node", () => {
            if (runtime.mode !== "chord") return;
            if (!runtime.chart) return;
            if (runtime.internalSelection) return;

            const sel = cy.nodes(":selected");
            if (!sel || !sel.length) {
                runtime.pinnedOnexusId = null;
                runtime.chart.setPinnedOnexusId(null);
                return;
            }
            const id = sel[0].id();
            runtime.pinnedOnexusId = id;
            runtime.chart.setPinnedOnexusId(id);
            try { window.updateDetailsForNode?.(sel[0]); } catch { }
        });
    }

    // ------------------------------
    // Keyboard UX (Chord view)
    // ------------------------------
    function hookKeys() {
        if (document.__onxChordKeysHooked) return;
        document.__onxChordKeysHooked = true;

        document.addEventListener("keydown", (e) => {
            // ignore typing
            const tag = (e.target && e.target.tagName) || "";
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

            if (runtime.mode !== "chord") return;

            if (e.key === "Escape") {
                e.preventDefault();
                runtime.pinnedOnexusId = null;
                runtime.chart?.setPinnedOnexusId(null);
                try { window.cy?.elements().unselect(); } catch { }
                return;
            }

            if (e.key === "Enter") {
                // Jump to graph & fit selected node
                const cy = window.cy;
                if (!cy) return;
                const id = runtime.pinnedOnexusId;
                if (!id) return;
                const node = cy.getElementById(id);
                if (!node || !node.nonempty || !node.nonempty()) return;

                e.preventDefault();
                setMode("graph");
                setTimeout(() => {
                    try { cy.fit(node, 60); } catch { }
                }, 30);
            }
        });
    }

    function pickSubsetNodeTypes(meta) {
        const view = String(meta?.view ?? meta?.schema ?? "").toLowerCase();
        if (String(meta?.view ?? "").toLowerCase() === "circle-chord") return ["Topic"];
        return ["Solution", "Capability", "Format", "Standard"];
    }

    // ------------------------------
    // Boot
    // ------------------------------
    function boot() {
        const btn = ensureToolbarBtn();
        if (btn && !btn.__onxHooked) {
            btn.__onxHooked = true;
            btn.addEventListener("click", (e) => { e.preventDefault(); toggleMode(); });
        }

        // Keep meta alias stable for snapshot (core uses __onexus_meta in places)
        window.__onexus_meta = window.__onexus_meta || window.___onexus_meta || window.__onexus_meta;

        hookKeys();

        // React to ONEXUS lifecycle events
        try {
            bus?.on?.("graphLoaded", () => {
                hookSelectionSync();
                if (runtime.mode === "chord") refreshChord();
            });
            bus?.on?.("layerModeChanged", () => {
                if (runtime.mode === "chord") refreshChord();
            });
        } catch { }

        // Also refresh chord after graph edits (node/edge add/remove) if active
        try {
            const cy = window.cy;
            if (cy && !cy.__onxChordGraphHooked) {
                cy.__onxChordGraphHooked = true;
                cy.on("add remove", () => { if (runtime.mode === "chord") refreshChord(); });
            }
        } catch { }

        // Restore persisted mode
        const mode = readViewMode();
        setMode(mode === "chord" ? "chord" : "graph");
    }

    // Register as a plugin (so it autoloads)
    if (typeof ONX.registerPlugin === "function") {
        ONX.registerPlugin({
            id: "chord-view",
            title: "Chord View (D3)",
            register() {
                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
                } else {
                    setTimeout(boot, 0);
                }
            }
        });
    } else {
        // fallback
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
        } else {
            setTimeout(boot, 0);
        }
    }
})();