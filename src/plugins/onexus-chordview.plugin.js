/* =========================================================
 ONEXUS Plugin — Chord View (D3 edge-bundling)

 SET D PATCH:
 - Do NOT set #cy to display:none (this breaks Cytoscape viewport/fit/layout).
 - Instead: keep #cy mounted, set opacity:0 + pointer-events:none while chord is active.
 - Hide/show minimap + overlays without affecting cy size.
 - Preserve selection sync with Cytoscape nodes (pin ↔ select).
========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    const bus = ONX.bus;
    const CFG = {
        viewKey: "chord",
        viewLabel: "Circle Chord",
        d3Url: "https://d3js.org/d3.v7.min.js",
        cssUrl: "./src/views/chord/styles.css",
        chartUrl: "./src/views/chord/circle-chart.js",
        defaultNodeTypes: ["Solution", "Capability", "Format", "Standard"],
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

    // ---------------------------------------------------------
    // ✅ Set D: visibility control WITHOUT display:none on #cy
    // ---------------------------------------------------------
    const overlayIdsToToggle = [
        "minimap",
        "legendOverlay",
        "metricsOverlay",
        "onxFloatDetails",
        "cy-context-menu",
    ];

    function setOverlayVisible(el, visible) {
        if (!el) return;
        if (!el.dataset) el.dataset = {};
        if (el.dataset.__onxPrevDisplay === undefined) {
            // cache initial display only once
            el.dataset.__onxPrevDisplay = el.style.display || "";
        }
        el.style.display = visible ? (el.dataset.__onxPrevDisplay || "") : "none";
    }

    function setGraphVisible(isGraph) {
        const cyEl = $("cy");
        const host = $("onx-chord-host");

        if (host) {
            host.classList.toggle("active", !isGraph);
            host.style.pointerEvents = isGraph ? "none" : "auto";
        }

        // IMPORTANT: keep cy mounted and sized
        if (cyEl) {
            // never display:none
            cyEl.style.opacity = isGraph ? "1" : "0";
            cyEl.style.pointerEvents = isGraph ? "auto" : "none";
            // keep layout space unchanged
            cyEl.style.visibility = "visible";
        }

        // hide overlays while chord is active
        for (const id of overlayIdsToToggle) {
            setOverlayVisible($(id), isGraph);
        }

        // Ensure Cytoscape knows it can render immediately after toggles
        // (safe even if no size changed)
        try { window.cy?.resize?.(); } catch { }
        requestAnimationFrame(() => { try { window.cy?.resize?.(); } catch { } });
    }

    function safeCyResize() {
        try { window.cy?.resize?.(); } catch { }
        requestAnimationFrame(() => { try { window.cy?.resize?.(); } catch { } });
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

        if (!arcOrder && Array.isArray(m.arcOrder)) arcOrder = m.arcOrder.slice();
        return { key, arcOrder, nodeTypeAllow };
    }

    function snapshotVisibleSubgraph(cy, subsetNodeTypes, arcOrder) {
        const allow = new Set((subsetNodeTypes || []).map(String));

        const visNodes = cy.nodes(":visible")
            .map(n => ({ data: { ...n.data() } }))
            .filter(nw => allow.size === 0 || allow.has(String(nw.data.nodeType || "")));

        const allowedIds = new Set(visNodes.map(nw => String(nw.data.id)));

        const visEdges = cy.edges(":visible")
            .filter(e => allowedIds.has(String(e.data("source"))) && allowedIds.has(String(e.data("target"))))
            .map(e => ({ data: { ...e.data() } }));

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
    };

    // ------------------------------
    // Auto pick nodeTypeAllow for generic graphs
    // ------------------------------
    function countByNodeType(graph) {
        const nodes = graph?.elements?.nodes ?? [];
        const map = new Map();
        for (const nw of nodes) {
            const d = nw?.data ?? nw ?? {};
            const t = String(d.nodeType ?? "").trim() || "Unknown";
            map.set(t, (map.get(t) ?? 0) + 1);
        }
        return map;
    }

    function pickAutoNodeTypeAllow(graph) {
        const counts = countByNodeType(graph);
        const types = Array.from(counts.keys());

        const preferred = [
            "Component", "Element", "System", "Space", "Organization", "Vendor",
            "Capability", "Solution", "Format", "Standard", "Topic"
        ];

        const candidates = types
            .map(t => ({ t, c: counts.get(t) ?? 0, pref: preferred.includes(t) ? preferred.indexOf(t) : 999 }))
            .sort((a, b) => (a.pref - b.pref) || (a.c - b.c));

        for (const x of candidates) {
            if (x.c >= 8 && x.c <= 160) return [x.t];
        }

        const picked = [];
        let sum = 0;
        for (const x of candidates) {
            if (x.c < 2) continue;
            picked.push(x.t);
            sum += x.c;
            if (sum >= 10) break;
        }
        if (picked.length) return picked;
        return types;
    }

    function applyMetaConfig(meta, loadedGraphForFallback) {
        const cfg = getChordCfgFromMeta(meta);

        if (Array.isArray(cfg.nodeTypeAllow) && cfg.nodeTypeAllow.length) {
            runtime.subsetNodeTypes = cfg.nodeTypeAllow.slice();
            runtime.arcOrder = cfg.arcOrder || null;
            return;
        }

        const key = String(cfg.key || "").toLowerCase();
        if (key.includes("circle-chord")) {
            runtime.subsetNodeTypes = ["Topic"];
            runtime.arcOrder = cfg.arcOrder || null;
            return;
        }

        if (loadedGraphForFallback) {
            runtime.subsetNodeTypes = pickAutoNodeTypeAllow(loadedGraphForFallback);
        } else {
            runtime.subsetNodeTypes = CFG.defaultNodeTypes.slice();
        }
        runtime.arcOrder = cfg.arcOrder || null;
    }



    async function mountChord() {
        const cy = window.cy;
        if (!cy) return;

        await ensureDeps();
        ensureHost();

        // Activate chord overlay
        setGraphVisible(false);
        runtime.active = true;

        if (!runtime.chart) {
            const svg = $("onxChordSvg");
            runtime.chart = window.ONEXUS_CIRCLE_CHART.create(svg, {
                language: window.__onexus_state?.language ?? window.___onexus_state?.language ?? "en",
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
        runtime.active = false;
        setGraphVisible(true);
        safeCyResize();
    }

    const refreshChord = debounce(() => {
        const cy = window.cy;
        if (!cy || !runtime.chart || !runtime.active) return;

        const g = snapshotVisibleSubgraph(cy, runtime.subsetNodeTypes, runtime.arcOrder);
        runtime.chart.setGraph(g, {
            language: window.__onexus_state?.language ?? window.___onexus_state?.language ?? "en",
            nodeTypeAllow: runtime.subsetNodeTypes,
        });

        const sel = cy.nodes(":selected");
        if (sel && sel.length && !runtime.pinnedOnexusId) {
            const id = sel[0].id();
            runtime.pinnedOnexusId = id;
            runtime.chart.setPinnedOnexusId(id);
        } else if (runtime.pinnedOnexusId) {
            runtime.chart.setPinnedOnexusId(runtime.pinnedOnexusId);
        }
    }, 140);

    function ensureViewOption() {
        const sel = $("layoutSelect");
        if (!sel) return;
        if ([...sel.options].some(o => o.value === CFG.viewKey)) return;
        const opt = document.createElement("option");
        opt.value = CFG.viewKey;
        opt.textContent = CFG.viewLabel;
        sel.appendChild(opt);
    }

    function wrapApplyLayoutOnce() {
        if (runtime.wrappedApplyLayout) return;
        if (typeof window.applyLayout !== "function") return;

        runtime.wrappedApplyLayout = true;
        const orig = window.applyLayout;

        window.applyLayout = function (type) {
            const t = String(type ?? "default");

            if (t === CFG.viewKey) {
                const cy = window.cy;
                const curGraph = {
                    meta: window.__onexus_meta || {},
                    elements: {
                        nodes: cy.nodes().map(n => ({ data: { ...n.data() } })),
                        edges: cy.edges().map(e => ({ data: { ...e.data() } })),
                    }
                };
                applyMetaConfig(window.__onexus_meta, curGraph);
                mountChord();
                return;
            }

            // switching away from chord
            if (runtime.active) unmountChord();

            const r = orig.call(this, t);
            safeCyResize();
            return r;
        };
    }

    function hookGraphEvents() {
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
    }

    function boot() {
        ensureViewOption();
        wrapApplyLayoutOnce();
        applyMetaConfig(window.__onexus_meta);

        hookGraphEvents();

        try {
            bus?.on?.("graphLoaded", (payload) => {
                applyMetaConfig(payload?.meta || window.__onexus_meta);
                if (runtime.active) refreshChord();
            });
        } catch { }
    }

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