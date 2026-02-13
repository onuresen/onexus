/* =========================================================
 ONEXUS – LayerMode Foundation
 - Registers default layers and defines behavior hooks
 - Uses window.setLayerMode / window.registerLayerMode from graph-core.state.js
 - Uses style hooks from onexus-style.js: setStyleHooks/clearStyleHooks
 - Reapplies layer effects on graph changes (add/remove/load)
========================================================= */
(function () {
    const cy = window.cy;
    if (!cy) return;

    const U = window.ONEXUS?.util || {};
    const debounce = U.debounce || ((fn, ms = 80) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; });
    const idSafe = U.idSafe || ((s) => String(s ?? "").replace(/[^\w\-:.]+/g, "_"));

    // ---------- helpers ----------
    const exists = (col) => !!col && !!col.nonempty && col.nonempty();
    const state = window.__onexus_state;

    function safeShowAllEdges() {
        // resets relationship/dimension/phase filters
        window.showAllEdges?.();
        window.clearRelationshipFilter?.();
    }

    function applyDefaultView({ layout = "default", fit = true } = {}) {
        window.applyLayout?.(layout);
        if (fit) cy.fit(undefined, 50);
    }

    function setLegendHint(text) {
        // optional: just a toast for now
        if (text) window.showTransientMessage?.(text);
    }

    // Risk parsing: supports numbers or common strings
    function parseRisk(v) {
        if (v == null) return null;
        if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
        const s = String(v).trim().toLowerCase();
        if (!s) return null;
        if (s === "high" || s === "h" || s === "3") return 1.0;
        if (s === "medium" || s === "med" || s === "m" || s === "2") return 0.6;
        if (s === "low" || s === "l" || s === "1") return 0.2;
        const n = parseFloat(s);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
    }

    function riskBucket01(x) {
        if (x == null) return null;
        if (x >= 0.75) return "risk-high";
        if (x >= 0.4) return "risk-med";
        return "risk-low";
    }

    // Computes node risk as max incident edge risk
    function computeRiskScores() {
        const nodeRisk = new Map(); // id -> 0..1
        cy.edges(":visible").forEach((e) => {
            const r = parseRisk(e.data("risk"));
            if (r == null) return;
            const s = e.data("source");
            const t = e.data("target");
            if (s) nodeRisk.set(s, Math.max(nodeRisk.get(s) ?? 0, r));
            if (t) nodeRisk.set(t, Math.max(nodeRisk.get(t) ?? 0, r));
        });
        return nodeRisk;
    }

    function clearLayerClasses() {
        cy.nodes().removeClass("layer-risk layer-lifecycle layer-option");
        cy.edges().removeClass("layer-risk layer-lifecycle layer-option");
        // remove computed buckets
        cy.nodes().removeClass("risk-low risk-med risk-high");
        cy.edges().removeClass("risk-low risk-med risk-high conf-inferred conf-explicit");
    }

    // ---------- layer behaviors ----------
    function enterRelationship() {
        clearLayerClasses();
        window.clearStyleHooks?.();
        safeShowAllEdges();
        setLegendHint("Layer: Relationship");
    }

    function enterLifecycle() {
        clearLayerClasses();
        cy.nodes().addClass("layer-lifecycle");
        cy.edges().addClass("layer-lifecycle");

        // show phase on edges (label hook)
        window.setStyleHooks?.({
            edgeLabelFn: (ele) => {
                const t = ele.data("displayType") ?? ele.data("type") ?? "";
                const ph = ele.data("phase") ?? [];
                const p = Array.isArray(ph) ? ph.filter(Boolean) : [String(ph)];
                return p.length ? `${t} · ${p.join(" / ")}` : t;
            },
            // keep base colors (no override)
            edgeColorFn: null,
            nodeColorFn: null,
            nodeLabelFn: null,
        });

        safeShowAllEdges();
        // lifecycle default: encourage phase filtering rather than hiding it
        window.buildPhaseFilter?.();
        setLegendHint("Layer: Lifecycle (edge labels include phase)");
    }

    function enterRisk() {
        clearLayerClasses();
        cy.nodes().addClass("layer-risk");
        cy.edges().addClass("layer-risk");

        // compute and apply classes
        const nodeRisk = computeRiskScores();
        cy.nodes().forEach((n) => {
            const r = nodeRisk.get(n.id());
            const b = riskBucket01(r);
            if (b) n.addClass(b);
        });
        cy.edges().forEach((e) => {
            const r = parseRisk(e.data("risk"));
            const b = riskBucket01(r);
            if (b) e.addClass(b);
            const conf = String(e.data("confidence") ?? "").trim().toLowerCase();
            if (conf === "inferred") e.addClass("conf-inferred");
            else if (conf) e.addClass("conf-explicit");
        });

        // style hooks: color by risk bucket; label includes risk/confidence
        const RISK_COLORS = { "risk-high": "#ef4444", "risk-med": "#f59e0b", "risk-low": "#10b981" };
        window.setStyleHooks?.({
            edgeColorFn: (ele, ctx) => {
                if (ele.hasClass("risk-high")) return RISK_COLORS["risk-high"];
                if (ele.hasClass("risk-med")) return RISK_COLORS["risk-med"];
                if (ele.hasClass("risk-low")) return RISK_COLORS["risk-low"];
                return ctx.base;
            },
            nodeColorFn: (ele, ctx) => {
                if (ele.hasClass("risk-high")) return "#ef4444";
                if (ele.hasClass("risk-med")) return "#f59e0b";
                if (ele.hasClass("risk-low")) return "#10b981";
                return ctx.base;
            },
            edgeLabelFn: (ele) => {
                const t = ele.data("displayType") ?? ele.data("type") ?? "";
                const r = ele.data("risk");
                const c = ele.data("confidence");
                const parts = [];
                if (r != null && String(r).trim() !== "") parts.push(`risk:${r}`);
                if (c != null && String(c).trim() !== "") parts.push(`conf:${c}`);
                return parts.length ? `${t} · ${parts.join(" ")}` : t;
            },
        });

        safeShowAllEdges();
        setLegendHint("Layer: Risk (colors encode risk; inferred edges styled)");
    }

    function enterOption() {
        clearLayerClasses();
        cy.nodes().addClass("layer-option");
        cy.edges().addClass("layer-option");

        // Identify option nodes (GD importer uses nodeType:"Option", category:"DesignOption")
        const optNodes = cy.nodes().filter((n) =>
            String(n.data("nodeType") ?? "").toLowerCase() === "option" ||
            String(n.data("category") ?? "").toLowerCase() === "designoption"
        );

        // Default layout: breadthfirst rooted at options if present
        if (optNodes.length) {
            cy.layout({ name: "breadthfirst", roots: optNodes, directed: true, spacingFactor: 1.4, animate: true }).run();
            cy.fit(optNodes.closedNeighborhood(), 60);
        } else {
            applyDefaultView({ layout: "default", fit: true });
        }

        // style: emphasize option nodes and Optimizes edges if present
        window.setStyleHooks?.({
            nodeColorFn: (ele, ctx) => {
                const isOpt = String(ele.data("nodeType") ?? "").toLowerCase() === "option";
                if (isOpt) return "#6366f1"; // indigo
                return ctx.base;
            },
            edgeColorFn: (ele, ctx) => {
                const t = String(ele.data("type") ?? "");
                if (t === "Optimizes") return "#6366f1";
                return ctx.base;
            },
        });

        safeShowAllEdges();
        setLegendHint("Layer: Option (roots = Option nodes)");
    }

    function exitAny() {
        // exit hook used by most layers
        clearLayerClasses();
        window.clearStyleHooks?.();
    }

    // ---------- register layers ----------
    // (registerLayerMode provided by graph-core.state.js)
    function register() {
        if (typeof window.registerLayerMode !== "function") return;

        window.registerLayerMode("relationship", {
            title: { en: "Relationship", jp: "関係" },
            onEnter: () => enterRelationship(),
            onExit: () => exitAny(),
        });

        window.registerLayerMode("lifecycle", {
            title: { en: "Lifecycle", jp: "ライフサイクル" },
            onEnter: () => enterLifecycle(),
            onExit: () => exitAny(),
        });

        window.registerLayerMode("risk", {
            title: { en: "Risk", jp: "リスク" },
            onEnter: () => enterRisk(),
            onExit: () => exitAny(),
        });

        window.registerLayerMode("option", {
            title: { en: "Option", jp: "オプション" },
            onEnter: () => enterOption(),
            onExit: () => exitAny(),
        });
    }

    // ---------- reapply on graph changes ----------
    const reapply = debounce(() => {
        const m = window.getLayerMode?.() ?? state?.layerMode ?? "relationship";
        // re-run enter behavior for the active mode (idempotent)
        if (m === "risk") enterRisk();
        else if (m === "lifecycle") enterLifecycle();
        else if (m === "option") enterOption();
        else enterRelationship();
    }, 120);

    function hook() {
        if (cy.__onexus_layer_foundation_hooked) return;
        cy.__onexus_layer_foundation_hooked = true;

        // element add/remove indicates load or edits; reapply layer effects
        cy.on("add remove", reapply);

        // If you use onexusLoadGraph() which clears + adds, add/remove will trigger.
        // Also listen to layer mode change event.
        try {
            window.ONEXUS?.bus?.on?.("layerModeChanged", () => reapply());
        } catch { }
    }

    // boot
    register();
    hook();

    // Apply current mode once at boot (silent)
    setTimeout(() => {
        const m = window.getLayerMode?.() ?? state?.layerMode ?? "relationship";
        window.setLayerMode?.(m, { persist: false, silent: true });
        reapply();
    }, 30);
})();