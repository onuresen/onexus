/* =========================================================
 ONEXUS Plugin — Sankey / Alluvial View (D3 Sankey)
 - Adds "Sankey / Alluvial" into View dropdown (layoutSelect)
 - When selected: overlays SVG Sankey; keeps Cytoscape mounted (opacity 0)
 - Aggregates ONEXUS edges into flows between groups (nodeType/category/etc.)
 - Reads config from meta.view:
   meta.view = { key:"sankey", groupBy:"nodeType", weight:"count|confidence", filter:{ dimension?, type?, phase? } }

 Depends:
 - ONEXUS.bus (optional)
 - ONEXUS.util.safeCyResize (optional; falls back)
 - D3 + d3-sankey loaded on demand via CDN
 - ./src/views/sankey/sankey-chart.js (exports window.ONEXUS_SANKEY_CHART)

========================================================= */
(function () {
    const ONX = (window.ONEXUS = window.ONEXUS || {});
    const bus = ONX.bus;

    const CFG = {
        viewKey: "sankey",
        viewLabel: "Sankey / Alluvial",
        d3Url: "https://d3js.org/d3.v7.min.js",
        d3SankeyUrl: "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js",
        cssUrl: "./src/views/sankey/styles.css",
        chartUrl: "./src/views/sankey/sankey-chart.js",
        defaultGroupBy: "nodeType", // nodeType | category | dimension | phase
        defaultWeight: "count",     // count | confidence
    };

    function $(id) { return document.getElementById(id); }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = () => resolve(true);
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
        if (!window.d3Sankey) await loadScript(CFG.d3SankeyUrl);
        await loadCssOnce(CFG.cssUrl, "onx-sankey-css");
        if (!window.ONEXUS_SANKEY_CHART) await loadScript(CFG.chartUrl);
    }

    function safeCyResize() {
        const fn = window.ONEXUS?.util?.safeCyResize;
        if (typeof fn === "function") return fn();
        try { window.cy?.resize?.(); } catch { }
        requestAnimationFrame(() => { try { window.cy?.resize?.(); } catch { } });
    }

    // ---------------------------
    // Overlay host
    // ---------------------------
    function ensureHost() {
        const wrap = $("canvas-wrap") || $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        let host = $("onx-sankey-host");
        if (!host) {
            host = document.createElement("div");
            host.id = "onx-sankey-host";
            host.innerHTML = `
        <div class="onx-sankey-topbar">
          <div class="onx-sankey-title">Sankey / Alluvial</div>
          <div class="onx-sankey-controls">
            <label>Group</label>
            <select id="onxSankeyGroupBy">
            <option value="nodeId_bipartite">node → node (bipartite)</option>
            <option value="srcType_relType_tgtType">src.nodeType → edge.type → tgt.nodeType</option>
            <option value="nodeType2">nodeType → nodeType (coarse)</option>
            <option value="category2">category → category (coarse)</option>
            </select>
            <label>Weight</label>
            <select id="onxSankeyWeight">
              <option value="count">count</option>
              <option value="confidence">confidence</option>
            </select>
            <button id="onxSankeyRefresh" type="button">Refresh</button>
            <button id="onxSankeyClose" type="button">Close</button>
          </div>
        </div>
        <svg id="onxSankeySvg" aria-label="Sankey view"></svg>
        <div class="onx-sankey-hint">Tip: click a node/link to select related elements in Cytoscape.</div>
      `;
            wrap.appendChild(host);
        }
        return host;
    }

    // keep cy mounted; just hide interaction/visibility
    const overlayIdsToToggle = ["minimap", "legendOverlay", "metricsOverlay", "onxFloatDetails", "cy-context-menu"];
    function setOverlayVisible(el, visible) {
        if (!el) return;
        if (el.dataset && el.dataset.__onxPrevDisplay === undefined) el.dataset.__onxPrevDisplay = el.style.display || "";
        el.style.display = visible ? (el.dataset?.__onxPrevDisplay || "") : "none";
    }

    function setGraphVisible(isGraph) {
        const cyEl = $("cy");
        const host = $("onx-sankey-host");
        if (host) host.classList.toggle("active", !isGraph);

        if (cyEl) {
            cyEl.style.opacity = isGraph ? "1" : "0";
            cyEl.style.pointerEvents = isGraph ? "auto" : "none";
            cyEl.style.visibility = "visible";
        }

        for (const id of overlayIdsToToggle) setOverlayVisible($(id), isGraph);

        safeCyResize();
    }

    // ---------------------------
    // Build Sankey data from ONEXUS graph (aggregate)
    // ---------------------------
    function getMetaViewCfg(meta) {
        const m = meta || window.__onexus_meta || window.___onexus_meta || {};
        const v = m.view;
        if (!v) return {};
        if (typeof v === "string") return { key: v };
        if (typeof v === "object") return v;
        return {};
    }

    function buildSankeyAggregate({ groupBy, weightMode, filter }) {
        const cy = window.cy;
        if (!cy) return { nodes: [], links: [], meta: {} };

        const f = filter || {};
        const dimPick = f.dimension ? String(f.dimension) : null;
        const typePick = f.type ? String(f.type) : null;
        const phasePick = f.phase ? String(f.phase) : null;

        // Node id -> display label (use ONEXUS displayLabel if present)
        const labelById = new Map();
        cy.nodes().forEach(n => {
            const d = n.data();
            labelById.set(n.id(), String(d.displayLabel ?? d.id ?? n.id()));
        });

        const nodesByKey = new Map();  // key -> index
        const linksByKey = new Map();  // "src\ntrg" -> {value, edgeIds, nodeIds}

        function normalizeConfidenceToWeight(conf) {
            if (conf == null) return 1;
            if (typeof conf === "number" && isFinite(conf)) return Math.max(0.05, Math.min(2, conf));
            const s = String(conf).trim().toLowerCase();
            if (!s) return 1;
            if (s === "high") return 1.4;
            if (s === "medium" || s === "med") return 1.0;
            if (s === "low") return 0.6;
            if (s === "inferred") return 0.4;
            const n = parseFloat(s);
            return isFinite(n) ? Math.max(0.05, Math.min(2, n)) : 1;
        }

        function ensureNode(key) {
            const k = String(key ?? "").trim() || "(unknown)";
            if (!nodesByKey.has(k)) nodesByKey.set(k, nodesByKey.size);
            return nodesByKey.get(k);
        }

        function addLink(srcKey, tgtKey, w, edgeId, sNodeId, tNodeId) {
            const s = String(srcKey ?? "(unknown)");
            const t = String(tgtKey ?? "(unknown)");
            ensureNode(s);
            ensureNode(t);

            const k = s + "\n" + t;
            let rec = linksByKey.get(k);
            if (!rec) rec = { sourceKey: s, targetKey: t, value: 0, edgeIds: new Set(), nodeIds: new Set() };
            rec.value += (Number.isFinite(w) ? w : 1);
            if (edgeId) rec.edgeIds.add(edgeId);
            if (sNodeId) rec.nodeIds.add(sNodeId);
            if (tNodeId) rec.nodeIds.add(tNodeId);
            linksByKey.set(k, rec);
        }

        function nodeTypeOf(n) { return String(n.data("nodeType") ?? "Component"); }
        function categoryOf(n) {
            const d = n.data();
            return String(d.category ?? d.revitCategory ?? "Uncategorized");
        }
        function edgeTypeOf(e) { return String(e.data("type") ?? "RelatedTo"); }

        // Use only visible edges (respects filters/layers)
        const edges = cy.edges(":visible");

        edges.forEach(e => {
            const d = e.data();

            // Optional filters
            if (dimPick && String(d.dimension) !== dimPick) return;
            if (typePick && String(d.type) !== typePick) return;
            if (phasePick) {
                const ph = d.phase ?? [];
                const list = Array.isArray(ph)
                    ? ph.map(String)
                    : String(ph).split("\n").map(x => x.trim()).filter(Boolean);
                if (!list.includes(String(phasePick))) return;
            }

            const sNode = e.source();
            const tNode = e.target();
            const w = (weightMode === "confidence") ? normalizeConfidenceToWeight(d.confidence) : 1;

            // ---------------------------------------------------
            // ✅ NEW: node → node bipartite (dense like chord/default)
            // Left nodes are separate IDs from right nodes to avoid cycles:
            //   L:<nodeId>  -> R:<nodeId>
            // ---------------------------------------------------
            if (groupBy === "nodeId_bipartite") {
                const sId = sNode.id();
                const tId = tNode.id();

                const L = "L:" + sId;
                const R = "R:" + tId;

                addLink(L, R, w, d.id, sId, tId);
                return;
            }

            // 3-stage alluvial (richer than coarse)
            if (groupBy === "srcType_relType_tgtType") {
                const L1 = "L1:" + nodeTypeOf(sNode);
                const L2 = "L2:" + edgeTypeOf(e);
                const L3 = "L3:" + nodeTypeOf(tNode);

                addLink(L1, L2, w, d.id, sNode.id(), tNode.id());
                addLink(L2, L3, w, d.id, sNode.id(), tNode.id());
                return;
            }

            // coarse fallbacks
            if (groupBy === "nodeType2") {
                addLink(nodeTypeOf(sNode), nodeTypeOf(tNode), w, d.id, sNode.id(), tNode.id());
                return;
            }

            if (groupBy === "category2") {
                addLink(categoryOf(sNode), categoryOf(tNode), w, d.id, sNode.id(), tNode.id());
                return;
            }

            // default fallback
            addLink(nodeTypeOf(sNode), nodeTypeOf(tNode), w, d.id, sNode.id(), tNode.id());
        });

        // Build node list with display labels
        const nodes = Array.from(nodesByKey.keys()).map(id => {
            // Present clean label in UI:
            // L:<id> => label of original node
            // R:<id> => label of original node
            let name = id;
            if (id.startsWith("L:")) name = labelById.get(id.slice(2)) ?? id.slice(2);
            else if (id.startsWith("R:")) name = labelById.get(id.slice(2)) ?? id.slice(2);
            else if (id.startsWith("L1:") || id.startsWith("L2:") || id.startsWith("L3:")) name = id.slice(3);

            return { id, name };
        });

        const links = Array.from(linksByKey.values()).map(r => ({
            source: r.sourceKey,
            target: r.targetKey,
            value: r.value,
            edgeIds: Array.from(r.edgeIds),
            nodeIds: Array.from(r.nodeIds),
        }));

        return { nodes, links, meta: { groupBy, weightMode, filter: f } };
    }

    function nodeTypeOf(n) { return String(n?.data?.("nodeType") ?? n?.data?.().nodeType ?? "Component"); }
    function categoryOf(n) {
        const d = n?.data?.() ?? {};
        return String(d.category ?? d.revitCategory ?? "Uncategorized");
    }
    function edgeTypeOf(e) { return String(e?.data?.("type") ?? e?.data?.().type ?? "RelatedTo"); }
    function edgeDimOf(e) { return String(e?.data?.("dimension") ?? e?.data?.().dimension ?? "System"); }

    function addAggLink(nodesById, linksByKey, srcKey, tgtKey, w, edgeId, sNodeId, tNodeId) {
        const s = String(srcKey || "(unknown)");
        const t = String(tgtKey || "(unknown)");
        if (!nodesById.has(s)) nodesById.set(s, nodesById.size);
        if (!nodesById.has(t)) nodesById.set(t, nodesById.size);

        const k = s + "\n" + t;
        let rec = linksByKey.get(k);
        if (!rec) rec = { sourceKey: s, targetKey: t, value: 0, edgeIds: new Set(), nodeIds: new Set() };
        rec.value += (Number.isFinite(w) ? w : 1);
        if (edgeId) rec.edgeIds.add(edgeId);
        if (sNodeId) rec.nodeIds.add(sNodeId);
        if (tNodeId) rec.nodeIds.add(tNodeId);
        linksByKey.set(k, rec);
    }

    // ---------------------------
    // Runtime
    // ---------------------------
    const runtime = {
        active: false,
        chart: null,
        wrappedApplyLayout: false,
        lastCfg: null
    };

    function ensureViewOption() {
        const sel = $("layoutSelect");
        if (!sel) return;
        if ([...sel.options].some(o => o.value === CFG.viewKey)) return;
        const opt = document.createElement("option");
        opt.value = CFG.viewKey;
        opt.textContent = CFG.viewLabel;
        sel.appendChild(opt);
    }

    function getCurrentCfgForUi(metaCfg) {
        const groupBy = String(metaCfg.groupBy ?? CFG.defaultGroupBy);
        const weight = String(metaCfg.weight ?? CFG.defaultWeight);
        const filter = (metaCfg.filter && typeof metaCfg.filter === "object") ? metaCfg.filter : {};
        return { groupBy, weight, filter };
    }

    async function mountSankey(metaCfg = {}) {
        await ensureDeps();
        ensureHost();

        // --- Ensure other overlays are not active (Chord, etc.) ---
        (function deactivateOtherViews() {
            // Chord host stays visible if .active is not removed
            const chordHost = document.getElementById("onx-chord-host");
            if (chordHost && chordHost.classList.contains("active")) {
                chordHost.classList.remove("active");
                chordHost.style.pointerEvents = "none";
            }
        })();

        setGraphVisible(false);
        runtime.active = true;

        const svg = $("onxSankeySvg");
        if (!svg) return;

        if (!runtime.chart) {
            runtime.chart = window.ONEXUS_SANKEY_CHART.create(svg, {
                onPick: (payload) => {
                    // payload: { nodeIds?, edgeIds? }
                    const cy = window.cy;
                    if (!cy) return;
                    try { cy.elements().unselect(); } catch { }
                    if (payload?.nodeIds?.length) {
                        payload.nodeIds.forEach(id => { try { cy.getElementById(id).select(); } catch { } });
                    }
                    if (payload?.edgeIds?.length) {
                        payload.edgeIds.forEach(id => { try { cy.getElementById(id).select(); } catch { } });
                    }
                    const firstNode = payload?.nodeIds?.[0];
                    if (firstNode) {
                        const n = cy.getElementById(firstNode);
                        try { window.updateDetailsForNode?.(n); } catch { }
                    }
                }
            });
        }

        // sync UI controls
        const $g = document.getElementById("onxSankeyGroupBy");
        const $w = $("onxSankeyWeight");
        const uiCfg = getCurrentCfgForUi(metaCfg);

        // Always force group dropdown to default to 'nodeId_bipartite' on load
        if ($g) {
            $g.value = "nodeId_bipartite";
        }
        if ($w) {
            $w.value = uiCfg.weight;
        }

        // Always use the current dropdown values for initial render
        const initialCfg = {
            groupBy: $g ? $g.value : "nodeId_bipartite",
            weight: $w ? $w.value : uiCfg.weight,
            filter: uiCfg.filter
        };
        runtime.lastCfg = initialCfg;
        refreshSankey(initialCfg);
    }

    function unmountSankey() {
        runtime.active = false;
        setGraphVisible(true);
        safeCyResize();
    }

    function refreshSankey(cfg) {
        if (!runtime.chart || !runtime.active) return;
        const agg = buildSankeyAggregate({
            groupBy: cfg.groupBy,
            weightMode: cfg.weight,
            filter: cfg.filter
        });
        runtime.chart.setData(agg);
    }

    function hookUiButtonsOnce() {
        const host = $("onx-sankey-host");
        if (!host || host.__onxHooked) return;
        host.__onxHooked = true;

        const btnClose = $("onxSankeyClose");
        const btnRefresh = $("onxSankeyRefresh");
        const selGroup = $("onxSankeyGroupBy");
        const selWeight = $("onxSankeyWeight");

        if (btnClose) btnClose.addEventListener("click", () => {
            // switch view back to default
            try { window.applyLayout?.("default"); } catch { unmountSankey(); }
        });

        if (btnRefresh) btnRefresh.addEventListener("click", () => {
            const cfg = {
                groupBy: selGroup?.value ?? CFG.defaultGroupBy,
                weight: selWeight?.value ?? CFG.defaultWeight,
                filter: runtime.lastCfg?.filter ?? {}
            };
            runtime.lastCfg = cfg;
            refreshSankey(cfg);
        });

        if (selGroup) selGroup.addEventListener("change", () => btnRefresh?.click());
        if (selWeight) selWeight.addEventListener("change", () => btnRefresh?.click());

        // ESC closes Sankey
        document.addEventListener("keydown", (e) => {
            if (!runtime.active) return;
            if (e.key === "Escape") {
                try { window.applyLayout?.("default"); } catch { unmountSankey(); }
            }
        });
    }

    function wrapApplyLayoutOnce() {
        if (runtime.wrappedApplyLayout) return;
        if (typeof window.applyLayout !== "function") return;

        runtime.wrappedApplyLayout = true;
        const orig = window.applyLayout;

        window.applyLayout = function (type) {
            const t = String(type ?? "default");

            if (t === CFG.viewKey) {
                const metaCfg = getMetaViewCfg(window.__onexus_meta || window.___onexus_meta);
                const cfg = getCurrentCfgForUi(metaCfg);
                mountSankey({ ...metaCfg, ...cfg }).then(() => hookUiButtonsOnce()).catch(err => {
                    console.error("[ONEXUS sankey] mount failed", err);
                    window.showTransientMessage?.("Sankey failed to load (see console)", 2200);
                    // fallback back to default
                    try { orig.call(this, "default"); } catch { }
                });
                return;
            }

            // switching away
            if (runtime.active) unmountSankey();

            const r = orig.call(this, t);
            safeCyResize();
            return r;
        };
    }

    function hookGraphEvents() {
        const cy = window.cy;
        if (!cy || cy.__onxSankeyHooked) return;
        cy.__onxSankeyHooked = true;

        // update view when graph changes
        cy.on("add remove", () => {
            if (!runtime.active) return;
            refreshSankey(runtime.lastCfg || { groupBy: CFG.defaultGroupBy, weight: CFG.defaultWeight, filter: {} });
        });
        cy.on("pan zoom resize layoutstop", () => {
            if (!runtime.active) return;
            runtime.chart?.requestRender?.();
        });

        // bus-driven refresh
        try {
            bus?.on?.("graphLoaded", () => {
                if (!runtime.active) return;
                refreshSankey(runtime.lastCfg || { groupBy: CFG.defaultGroupBy, weight: CFG.defaultWeight, filter: {} });
            });
        } catch { }
    }

    function boot() {
        ensureViewOption();
        wrapApplyLayoutOnce();
        hookGraphEvents();
    }

    // plugin registration (manifest autoload)
    if (typeof ONX.registerPlugin === "function") {
        ONX.registerPlugin({
            id: "sankey-view",
            title: "Sankey / Alluvial View (D3)",
            register() {
                if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
                else setTimeout(boot, 0);
            }
        });
    } else {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
        else setTimeout(boot, 0);
    }
})();