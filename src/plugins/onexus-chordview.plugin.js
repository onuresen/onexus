/* =========================================================
 ONEXUS Plugin — Chord View (D3 edge-bundling)
 UX CHANGE:
 - Move entry point from toolbar button -> View dropdown (#layoutSelect)
 - Adds View option: "Circle Chord" (value: "chord")
 - Wraps window.applyLayout() so selecting "chord" toggles overlay
 - Switching away from "chord" unmounts overlay + runs real layout
 Notes:
 - No edits required in graph-ui.bindings.js (it already calls applyLayout(value)) [2](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/indexCircle.html)
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    const LOG = window.ONEXUS_LOG || console;
    const bus = ONX.bus;

    const CFG = {
        // View dropdown item
        viewKey: "chord",
        viewLabel: "Circle Chord",
        // Dependencies
        d3Url: "https://d3js.org/d3.v7.min.js",
        cssUrl: "./src/views/chord/styles.css",
        chartUrl: "./src/views/chord/circle-chart.js",
        // Default subset (for solution landscape)
        defaultNodeTypes: ["Solution", "Capability", "Format", "Standard"],
        // If a dataset is “circle-chord”, prefer Topic unless overridden by meta.view.nodeTypeAllow
        topicDefaultNodeTypes: ["Topic"],
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

    function setGraphVisible(isGraph) {
        const cyEl = $("cy");
        const mm = $("minimap");
        if (cyEl) {
            cyEl.style.display = isGraph ? "block" : "none";
            cyEl.style.pointerEvents = isGraph ? "auto" : "none";
        }
        if (mm) mm.style.display = isGraph ? "block" : "none";
    }

    function getChordCfgFromMeta(meta) {
        const m = meta || window.__onexus_meta || window.___onexus_meta || {};
        const mv = m.view;

        let key = "";
        let arcOrder = null;
        let nodeTypeAllow = null;

        if (typeof mv === "string") {
            key = mv;
        } else if (mv && typeof mv === "object") {
            key = String(mv.key ?? "");
            if (Array.isArray(mv.arcOrder)) arcOrder = mv.arcOrder.slice();
            if (Array.isArray(mv.nodeTypeAllow)) nodeTypeAllow = mv.nodeTypeAllow.slice();
        }

        // back-compat
        if (!arcOrder && Array.isArray(m.arcOrder)) arcOrder = m.arcOrder.slice();

        return { key, arcOrder, nodeTypeAllow };
    }

    function snapshotVisibleSubgraph(cy, subsetNodeTypes, arcOrder) {
        const allow = new Set((subsetNodeTypes || []).map(String));

        const visNodes = cy.nodes(":visible")
            .map((n) => ({ data: { ...n.data() } }))
            .filter((nw) => allow.size === 0 || allow.has(String(nw.data.nodeType || "")));

        const allowedIds = new Set(visNodes.map((nw) => String(nw.data.id)));

        const visEdges = cy.edges(":visible")
            .filter((e) => allowedIds.has(String(e.data("source"))) && allowedIds.has(String(e.data("target"))))
            .map((e) => ({ data: { ...e.data() } }));

        const meta = window.__onexus_meta || window.___onexus_meta || {};
        const view = {};
        if (Array.isArray(arcOrder) && arcOrder.length) view.arcOrder = arcOrder.slice();

        return { meta, view, elements: { nodes: visNodes, edges: visEdges } };
    }

    function debounce(fn, ms = 140) {
        let t = 0;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    const runtime = {
        active: false,
        chart: null,
        pinnedOnexusId: null,
        internalSelection: false,
        subsetNodeTypes: CFG.defaultNodeTypes.slice(),
        arcOrder: null,
        wrappedApplyLayout: false,
        injectedViewOption: false,
    };

    function applyMetaConfig(meta) {
        const cfg = getChordCfgFromMeta(meta);

        // nodeTypeAllow from meta overrides everything
        if (Array.isArray(cfg.nodeTypeAllow) && cfg.nodeTypeAllow.length) {
            runtime.subsetNodeTypes = cfg.nodeTypeAllow.slice();
        } else {
            const k = String(cfg.key || "").toLowerCase();
            runtime.subsetNodeTypes = k.includes("circle-chord")
                ? CFG.topicDefaultNodeTypes.slice()
                : CFG.defaultNodeTypes.slice();
        }

        runtime.arcOrder = cfg.arcOrder || null;
    }

    async function mountChord() {
        const cy = window.cy;
        if (!cy) return;

        await ensureDeps();

        const host = ensureHost();
        if (!host) return;

        host.classList.add("active");
        setGraphVisible(false);
        runtime.active = true;

        if (!runtime.chart) {
            const svg = $("onxChordSvg");
            runtime.chart = window.ONEXUS_CIRCLE_CHART.create(svg, {
                language: window.___onexus_state?.language || window.__onexus_state?.language || "en",
                nodeTypeAllow: runtime.subsetNodeTypes,
                onPinChanged: (onexusId) => {
                    runtime.pinnedOnexusId = onexusId || null;

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
        runtime.active = false;
    }

    const refreshChord = debounce(() => {
        const cy = window.cy;
        if (!cy || !runtime.chart || !runtime.active) return;

        const g = snapshotVisibleSubgraph(cy, runtime.subsetNodeTypes, runtime.arcOrder);

        runtime.chart.setGraph(g, {
            language: window.___onexus_state?.language || window.__onexus_state?.language || "en",
            nodeTypeAllow: runtime.subsetNodeTypes,
        });

        // re-pin from graph selection
        const sel = cy.nodes(":selected");
        if (sel && sel.length && !runtime.pinnedOnexusId) {
            const id = sel[0].id();
            runtime.pinnedOnexusId = id;
            runtime.chart.setPinnedOnexusId(id);
        } else if (runtime.pinnedOnexusId) {
            runtime.chart.setPinnedOnexusId(runtime.pinnedOnexusId);
        }
    }, 140);

    // ------------------------------
    // View dropdown integration
    // ------------------------------
    function ensureViewOption() {
        const sel = $("layoutSelect");
        if (!sel) return;

        // already there?
        if ([...sel.options].some(o => o.value === CFG.viewKey)) {
            runtime.injectedViewOption = true;
            return;
        }

        const opt = document.createElement("option");
        opt.value = CFG.viewKey;
        opt.textContent = CFG.viewLabel;
        sel.appendChild(opt);

        runtime.injectedViewOption = true;
    }

    // ------------------------------
    // Intercept applyLayout('chord')
    // ------------------------------
    function wrapApplyLayoutOnce() {
        if (runtime.wrappedApplyLayout) return;
        if (typeof window.applyLayout !== "function") return;

        runtime.wrappedApplyLayout = true;

        const orig = window.applyLayout;

        window.applyLayout = function (type) {
            const t = String(type ?? "default");

            // Selecting chord in View dropdown -> mount overlay (no cy layout run)
            if (t === CFG.viewKey) {
                applyMetaConfig(window.__onexus_meta);
                mountChord();
                return;
            }

            // Switching away from chord -> unmount overlay then run real layout
            if (runtime.active) unmountChord();

            return orig.call(this, t);
        };
    }

    // Keep dropdown selection consistent when we auto-refresh chord
    function syncDropdownIfNeeded() {
        const sel = $("layoutSelect");
        if (!sel) return;
        if (runtime.active && sel.value !== CFG.viewKey) sel.value = CFG.viewKey;
    }

    // ------------------------------
    // React to lifecycle events
    // ------------------------------
    function hookEvents() {
        const cy = window.cy;
        if (!cy || cy.__onxChordHooked) return;
        cy.__onxChordHooked = true;

        cy.on("add remove", () => { if (runtime.active) refreshChord(); });

        cy.on("select unselect", "node", () => {
            if (!runtime.active || !runtime.chart) return;
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

        // ESC clears pinned selection (chord-only)
        document.addEventListener("keydown", (e) => {
            const tag = e.target?.tagName || "";
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if (!runtime.active) return;

            if (e.key === "Escape") {
                e.preventDefault();
                runtime.pinnedOnexusId = null;
                runtime.chart?.setPinnedOnexusId(null);
                try { cy.elements().unselect(); } catch { }
            }
        });
    }

    function boot() {
        ensureViewOption();
        wrapApplyLayoutOnce();

        // Initial meta-based config
        applyMetaConfig(window.__onexus_meta);

        hookEvents();

        // If user had saved onexus.layout=chord, bindings will call applyLayout('chord') on restore. [2](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/indexCircle.html)
        // Our wrapper will catch it and mount.
        try {
            bus?.on?.("graphLoaded", (payload) => {
                applyMetaConfig(payload?.meta || window.__onexus_meta);
                if (runtime.active) refreshChord();
            });
            bus?.on?.("layerModeChanged", () => { if (runtime.active) refreshChord(); });
        } catch { }

        // Keep dropdown aligned when chord is active (some scripts may re-render toolbar)
        setTimeout(syncDropdownIfNeeded, 150);
        setTimeout(syncDropdownIfNeeded, 600);
    }

    // Plugin registration
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
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
        } else {
            setTimeout(boot, 0);
        }
    }
})();