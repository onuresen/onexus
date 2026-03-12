/* =========================================================
ONEXUS – Runtime Module Audit (NO SIDE EFFECTS)
- Prints status of critical globals, DOM anchors, loaded scripts
- Flags likely duplicates / stale responsibilities
- Exposes: window.ONEXUS_AUDIT.run()
========================================================= */
(function () {
    const TS = () => new Date().toISOString();

    function exists(x) {
        return x !== undefined && x !== null;
    }

    function isFn(x) {
        return typeof x === "function";
    }

    function el(id) {
        return document.getElementById(id);
    }

    function rect(node) {
        try {
            if (!node) return null;
            const r = node.getBoundingClientRect();
            if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        } catch {
            return null;
        }
    }

    function styleProp(node, prop) {
        try {
            if (!node) return null;
            return getComputedStyle(node).getPropertyValue(prop);
        } catch {
            return null;
        }
    }

    function safeGet(path, root = window) {
        try {
            return path.split(".").reduce((a, k) => (a ? a[k] : undefined), root);
        } catch {
            return undefined;
        }
    }

    function listLoadedScripts() {
        const out = [];
        for (const s of Array.from(document.scripts || [])) {
            const src = (s.getAttribute("src") || "").trim();
            if (src) out.push(src);
        }
        return out;
    }

    function matchAny(str, patterns) {
        return patterns.some((p) => (p instanceof RegExp ? p.test(str) : String(str).includes(String(p))));
    }

    function summarizeScripts(scripts) {
        const buckets = {
            helpers: [],
            core: [],
            ui: [],
            importers: [],
            layout: [],
            common: [],
            libs: [],
            other: [],
        };

        const rules = [
            { key: "libs", patterns: [/cytoscape/i, /navigator/i, /svg/i, /web-ifc/i] },
            { key: "helpers", patterns: [/onexus-ns\.js$/i, /onexus-style\.js$/i] },
            { key: "core", patterns: [/graph-core\./i] },
            { key: "ui", patterns: [/graph-ui\./i] },
            { key: "importers", patterns: [/cobie-importer/i, /ifc-importer/i, /gd-importer/i] },
            { key: "layout", patterns: [/layout-/i] },
            { key: "common", patterns: [/onexus-common/i, /onexus-bootcheck/i] },
        ];

        for (const src of scripts) {
            const r = rules.find((x) => matchAny(src, x.patterns));
            (buckets[r ? r.key : "other"]).push(src);
        }
        return buckets;
    }

    function checkGlobals() {
        const checks = [
            // Core graph / state
            { name: "cy", ok: () => exists(window.cy) && isFn(window.cy.nodes) }, // cy is created in graph-core.state.js
            { name: "__onexus_state", ok: () => exists(window.__onexus_state) && typeof window.__onexus_state === "object" }, // exported in graph-core.state.js
            { name: "setLanguage", ok: () => isFn(window.setLanguage) }, // graph-core.state.js
            { name: "applyLayout", ok: () => isFn(window.applyLayout) }, // graph-core.layouts.js
            { name: "applyTheme", ok: () => isFn(window.applyTheme) }, // onexus-style.js
            { name: "buildRelationshipLegend", ok: () => isFn(window.buildRelationshipLegend) }, // graph-core.filters.js
            { name: "updateMetrics", ok: () => isFn(window.updateMetrics) }, // graph-core.filters.js
            { name: "onexusLoadGraph", ok: () => isFn(window.onexusLoadGraph) }, // graph-core.io.host.js

            // Undo / editing
            { name: "ONEXUS_UNDO", ok: () => exists(window.ONEXUS_UNDO) && isFn(window.ONEXUS_UNDO.do) }, // graph-core.undo.js
            { name: "openNodeWizard", ok: () => isFn(window.openNodeWizard) }, // graph-core.nodes.js
            { name: "openEdgeWizard", ok: () => isFn(window.openEdgeWizard) }, // graph-core.context.link.js

            // Layering
            { name: "getLayerMode", ok: () => isFn(window.getLayerMode) }, // graph-core.state.js
            { name: "setLayerMode", ok: () => isFn(window.setLayerMode) }, // graph-core.state.js
            { name: "registerLayerMode", ok: () => isFn(window.registerLayerMode) }, // graph-core.state.js
            { name: "ONEXUS_LAYERS", ok: () => exists(window.ONEXUS_LAYERS) }, // graph-core.state.js

            // Filters / orphan logic
            { name: "ONEXUS_FILTERS", ok: () => exists(window.ONEXUS_FILTERS) && isFn(window.ONEXUS_FILTERS.applyHideIsolatedNodesFromVisibleEdges) }, // graph-core.filters.js

            // Compare / path / lifecycle / nodevis / importers
            { name: "ONEXUS_COMPARE", ok: () => exists(window.ONEXUS_COMPARE) && isFn(window.ONEXUS_COMPARE.compareAB) }, // graph-core.compare.js
            { name: "onexusPath", ok: () => exists(window.onexusPath) && isFn(window.onexusPath.shortestTo) }, // graph-core.path.js
            { name: "ONEXUS_LIFECYCLE", ok: () => exists(window.ONEXUS_LIFECYCLE) && isFn(window.ONEXUS_LIFECYCLE.setPhase) }, // graph-core.layerMode.lifecycle.js
            { name: "ONEXUS_NODEVIS", ok: () => exists(window.ONEXUS_NODEVIS) && isFn(window.ONEXUS_NODEVIS.toggleCategoryVisible) }, // graph-ui.nodeVisWidget.js
            { name: "IMPORT_GD", ok: () => exists(window.IMPORT_GD) && isFn(window.IMPORT_GD.importFromPayload) }, // gd-importer.js
            { name: "ONEXUS_IFC", ok: () => exists(window.ONEXUS_IFC) && isFn(window.ONEXUS_IFC.loadIFC) }, // ifc-importer.js
            { name: "ONEXUS_COBie", ok: () => exists(window.ONEXUS_COBie) && isFn(window.ONEXUS_COBie.loadCOBieCSVs) }, // cobie-importer.js

            // Shared UI helpers
            { name: "ONEXUS.ui.positionPopover", ok: () => isFn(safeGet("ONEXUS.ui.positionPopover")) }, // graph-ui.popoverPositioner.js
            { name: "handleUnifiedLoad", ok: () => isFn(window.handleUnifiedLoad) }, // graph-ui.loader.js
        ];

        return checks.map((c) => {
            let ok = false;
            let err = null;
            try { ok = !!c.ok(); } catch (e) { ok = false; err = e?.message ?? String(e); }
            return { name: c.name, ok, err };
        });
    }

    function checkDomAnchors() {
        // These ids are referenced directly by core/UI modules (legend/metrics loader etc.)
        const ids = [
            "cy",
            "canvas-wrap",
            "toolbar",
            "fileInput",
            "legend",
            "metrics",
            "details",
            "minimap",
            "languageSelect",
            "layoutSelect",
            "themeSelect",
            "layerModeSelect",

            // left-rail specific (optional)
            "leftRail",
            "leftDrawer",

            // classic right sidebar (optional)
            "sidebar",

            // overlays (optional, but helpful in left-rail)
            "legendOverlay",
            "metricsOverlay",
        ];

        return ids.map((id) => {
            const node = el(id);
            const ok = !!node;
            return {
                id,
                ok,
                rect: ok ? rect(node) : null,
            };
        });
    }

    function detectDuplicateResponsibilities(scripts) {
        // Heuristic flags only; no behavior changes.
        const flags = [];

        // Popover positioners: should be exactly one shared positioner utility
        const popoverHits = scripts.filter((s) => matchAny(s, [/popoverPositioner/i, /positionPopover/i]));
        if (popoverHits.length > 1) {
            flags.push({
                kind: "dup-ui",
                title: "Multiple popover positioning modules detected",
                detail: popoverHits.slice(0, 10),
                risk: "medium",
            });
        }

        // Minimap movers: leftDock is expected in left-rail; common CSS positions it absolute by default
        const minimapMoverHits = scripts.filter((s) => matchAny(s, [/leftDock/i, /floatZones/i]));
        if (minimapMoverHits.length > 1) {
            flags.push({
                kind: "dup-minimap",
                title: "Multiple minimap relocation modules detected",
                detail: minimapMoverHits.slice(0, 10),
                risk: "medium",
            });
        }

        // Orphan sync shim should be gone; warn if still loaded
        const orphanShim = scripts.filter((s) => matchAny(s, [/filters\.orphanSync/i]));
        if (orphanShim.length) {
            flags.push({
                kind: "legacy-orphan",
                title: "Legacy orphanSync shim still loaded",
                detail: orphanShim,
                risk: "high",
            });
        }

        return flags;
    }

    function checkLegendAndMetricsHealth() {
        // Core renders to #legend and #metrics. If missing, UI appears "gone".
        const legend = el("legend");
        const metrics = el("metrics");
        const okLegend = !!legend;
        const okMetrics = !!metrics;

        // Additional sanity: are they being populated (not always true before first load)
        const legendHasContent = okLegend ? (legend.childElementCount > 0 || (legend.textContent || "").trim().length > 0) : false;
        const metricsHasContent = okMetrics ? ((metrics.textContent || "").trim().length > 0 && (metrics.textContent || "").trim() !== "–") : false;

        return {
            okLegend,
            okMetrics,
            legendHasContent,
            metricsHasContent,
            legendRect: okLegend ? rect(legend) : null,
            metricsRect: okMetrics ? rect(metrics) : null,
        };
    }

    function checkMinimapHealth() {
        const mm = el("minimap");
        if (!mm) return { ok: false };

        const r = rect(mm);
        const pos = styleProp(mm, "position");
        const parent = mm.parentElement?.id || mm.parentElement?.tagName || null;

        // If left-rail main: you typically want minimap top-left and position "relative" after being moved.
        // We don't enforce, just report.
        return {
            ok: true,
            rect: r,
            position: (pos || "").trim(),
            parent,
        };
    }

    function checkLayerWidgetHealth() {
        // layer widget uses these ids in UI module and common css
        const fab = el("onx-layer-fab");
        const pop = el("onx-layer-pop");
        return {
            fab: !!fab,
            pop: !!pop,
            popVisible: !!pop && pop.style.display !== "none",
        };
    }

    function runAudit({ verbose = true } = {}) {
        const scripts = listLoadedScripts();
        const buckets = summarizeScripts(scripts);
        const globals = checkGlobals();
        const dom = checkDomAnchors();
        const flags = detectDuplicateResponsibilities(scripts);
        const legendMetrics = checkLegendAndMetricsHealth();
        const minimap = checkMinimapHealth();
        const layerWidget = checkLayerWidgetHealth();

        const okGlobals = globals.filter((g) => g.ok).length;
        const badGlobals = globals.filter((g) => !g.ok);
        const okDom = dom.filter((d) => d.ok).length;
        const badDom = dom.filter((d) => !d.ok);

        // ---------- console output ----------
        console.groupCollapsed(`%c[ONEXUS AUDIT] ${TS()}  (globals ${okGlobals}/${globals.length}, dom ${okDom}/${dom.length})`,
            "color:#2563eb;font-weight:800;"
        );

        console.group("%cLoaded scripts (by category)", "font-weight:800;");
        Object.entries(buckets).forEach(([k, arr]) => {
            if (!arr.length) return;
            console.groupCollapsed(`${k} (${arr.length})`);
            arr.forEach((s) => console.log(s));
            console.groupEnd();
        });
        console.groupEnd();

        console.group("%cGlobals", "font-weight:800;");
        globals.forEach((g) => {
            if (g.ok) console.log(`✅ ${g.name}`);
            else console.warn(`❌ ${g.name}${g.err ? ` — ${g.err}` : ""}`);
        });
        console.groupEnd();

        console.group("%cDOM anchors", "font-weight:800;");
        dom.forEach((d) => {
            if (d.ok) console.log(`✅ #${d.id}`, d.rect || "");
            else console.warn(`❌ #${d.id} (missing)`);
        });
        console.groupEnd();

        console.group("%cLegend/Metrics health", "font-weight:800;");
        console.log(legendMetrics);
        console.groupEnd();

        console.group("%cMinimap health", "font-weight:800;");
        console.log(minimap);
        console.groupEnd();

        console.group("%cLayer widget health", "font-weight:800;");
        console.log(layerWidget);
        console.groupEnd();

        if (flags.length) {
            console.group("%cHeuristic warnings (possible duplicates / leftovers)", "font-weight:800;color:#b45309;");
            flags.forEach((f) => {
                console.warn(`[${f.risk}] ${f.title}`, f.detail);
            });
            console.groupEnd();
        } else {
            console.log("%cNo duplicate-responsibility flags detected (heuristic).", "color:#16a34a;font-weight:700;");
        }

        // Summary object for programmatic use
        const summary = {
            at: TS(),
            scriptsCount: scripts.length,
            buckets,
            globals,
            dom,
            flags,
            legendMetrics,
            minimap,
            layerWidget,
            counts: {
                globalsOk: okGlobals,
                globalsBad: badGlobals.length,
                domOk: okDom,
                domBad: badDom.length,
            },
        };

        if (verbose) {
            console.group("%cSummary object", "font-weight:800;");
            console.log(summary);
            console.groupEnd();
        }

        console.groupEnd();
        return summary;
    }

    // Expose API (non-invasive)
    window.ONEXUS_AUDIT = window.ONEXUS_AUDIT || {};
    window.ONEXUS_AUDIT.run = runAudit;
    window.ONEXUS_AUDIT.version = "1.0.0";

    // Auto-run once after load settles (safe)
    setTimeout(() => {
        try { runAudit({ verbose: false }); } catch (e) { console.warn("[ONEXUS AUDIT] failed:", e); }
    }, 350);
})();