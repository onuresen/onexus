/* =========================================================
 ONEXUS Plugin — Chord View (D3 edge-bundling)
 FIXES:
 - Reads chord config from meta.view (key, arcOrder, nodeTypeAllow)
 - Supports meta.view being string OR object
 - Optional JSON importer for chord datasets (meta.view.key / meta.view string == "circle-chord")
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
        // default subset for “solutions landscape”
        subsetNodeTypes: ["Solution", "Capability", "Format", "Standard"],
        persistKey: "onexus.viewMode",
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
        try { return localStorage.getItem(CFG.persistKey) || "graph"; }
        catch { return "graph"; }
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

        // Back-compat: allow meta.arcOrder
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

    function debounce(fn, ms = 120) {
        let t = 0;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    const runtime = {
        mode: "graph",
        chart: null,
        pinnedOnexusId: null,
        internalSelection: false,
        subsetNodeTypes: CFG.subsetNodeTypes.slice(),
        arcOrder: null,
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
                },
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

        const g = snapshotVisibleSubgraph(cy, runtime.subsetNodeTypes, runtime.arcOrder);
        runtime.chart.setGraph(g, {
            language: window.___onexus_state?.language || window.__onexus_state?.language || "en",
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

    function setMode(mode) {
        runtime.mode = mode === "chord" ? "chord" : "graph";
        writeViewMode(runtime.mode);
        if (runtime.mode === "chord") mountChord();
        else unmountChord();
    }

    function toggleMode() { setMode(runtime.mode === "chord" ? "graph" : "chord"); }

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

    function hookKeys() {
        if (document.__onxChordKeysHooked) return;
        document.__onxChordKeysHooked = true;

        document.addEventListener("keydown", (e) => {
            const tag = e.target?.tagName || "";
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
                const cy = window.cy;
                const id = runtime.pinnedOnexusId;
                if (!cy || !id) return;

                const node = cy.getElementById(id);
                if (!node || !node.nonempty || !node.nonempty()) return;

                e.preventDefault();
                setMode("graph");
                setTimeout(() => { try { cy.fit(node, 60); } catch { } }, 30);
            }
        });
    }

    function applyMetaConfig(meta) {
        const cfg = getChordCfgFromMeta(meta);

        // nodeTypeAllow: if provided, use it; otherwise use defaults
        if (Array.isArray(cfg.nodeTypeAllow)) {
            runtime.subsetNodeTypes = cfg.nodeTypeAllow.slice();
        } else {
            // if chord dataset is marked circle-chord, default to Topic
            const key = String(cfg.key || "").toLowerCase();
            runtime.subsetNodeTypes = key.includes("circle-chord") ? ["Topic"] : CFG.subsetNodeTypes.slice();
        }

        runtime.arcOrder = cfg.arcOrder || null;
    }

    // ------------------------------
    // Optional importer: chord JSON
    // ------------------------------
    function registerChordImporter(api) {
        if (!api?.registerImporter) return;

        api.registerImporter({
            id: "onexus-chord-json",
            label: "ONEXUS Chord JSON",
            priority: 60,
            extensions: ["json"],
            acceptMultiple: false,
            canHandleText: async (headText) => {
                const t = String(headText || "").toLowerCase();
                // narrow match: only chord datasets
                return t.includes("circle-chord") || t.includes("\"arcorder\"") && t.includes("\"view\"");
            },
            importFiles: async (files) => {
                const f = Array.from(files || [])[0];
                if (!f) return;
                const text = await f.text();
                const obj = JSON.parse(text);

                // Let core normalizer handle schema; but we want chord settings preserved.
                window.onexusLoadGraph?.(obj);

                // Switch to chord view after load
                setTimeout(() => setMode("chord"), 60);

                window.showTransientMessage?.("Imported chord dataset", 1400);
            },
            help: "Loads chord-oriented JSON (meta.view.key=\"circle-chord\" or view.arcOrder).",
        });
    }

    function boot() {
        const btn = ensureToolbarBtn();
        if (btn && !btn.__onxHooked) {
            btn.__onxHooked = true;
            btn.addEventListener("click", (e) => { e.preventDefault(); toggleMode(); });
        }

        hookKeys();
        applyMetaConfig(window.__onexus_meta);

        try {
            bus?.on?.("graphLoaded", (payload) => {
                applyMetaConfig(payload?.meta || window.__onexus_meta);
                hookSelectionSync();
                if (runtime.mode === "chord") refreshChord();
            });

            bus?.on?.("layerModeChanged", () => {
                if (runtime.mode === "chord") refreshChord();
            });
        } catch { }

        try {
            const cy = window.cy;
            if (cy && !cy.__onxChordGraphHooked) {
                cy.__onxChordGraphHooked = true;
                cy.on("add remove", () => { if (runtime.mode === "chord") refreshChord(); });
            }
        } catch { }

        // restore persisted mode
        const mode = readViewMode();
        setMode(mode === "chord" ? "chord" : "graph");
    }

    if (typeof ONX.registerPlugin === "function") {
        ONX.registerPlugin({
            id: "chord-view",
            title: "Chord View (D3)",
            register(api) {
                // ✅ register chord json importer (optional but matches your request)
                registerChordImporter(api);

                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
                } else {
                    setTimeout(boot, 0);
                }
            },
        });
    } else {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
        } else {
            setTimeout(boot, 0);
        }
    }
})();