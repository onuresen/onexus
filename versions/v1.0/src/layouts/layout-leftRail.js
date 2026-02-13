/* =========================================
   Layout: Left Rail behaviors (index_leftRail.html only)
   - Rail + drawer toggle
   - Legend/Metrics overlay relocation
   - Floating details
   Safe: no core edits; wraps existing functions only.
========================================= */

(function () {
    // Left rail + drawer toggle (overlay)
    const rail = document.getElementById("leftRail");
    const drawer = document.getElementById("leftDrawer");
    const title = document.getElementById("drawerTitle");
    const closeBtn = document.getElementById("drawerClose");
    const btnShortcutsRail = document.getElementById("btnShortcutsRail");

    const panels = ["panelFilter", "panelStyle", "panelAnim"];
    const TITLES = {
        panelFilter: "Filter / Lens",
        panelStyle: "Style",
        panelAnim: "Animation",
    };

    function showPanel(id) {
        panels.forEach((pid) => {
            const el = document.getElementById(pid);
            if (el) el.classList.toggle("show", pid === id);
        });
        if (title) title.textContent = TITLES[id] ?? "Panel";
        if (drawer) drawer.classList.add("open");
        rail?.querySelectorAll(".rail-btn").forEach((b) =>
            b.classList.toggle("active", b.dataset.panel === id)
        );
    }

    function closeDrawer() {
        drawer?.classList.remove("open");
        panels.forEach((pid) => document.getElementById(pid)?.classList.remove("show"));
        rail?.querySelectorAll(".rail-btn").forEach((b) => b.classList.remove("active"));
    }

    btnShortcutsRail?.addEventListener("click", () => {
        const help = document.getElementById("help");
        if (help) help.style.display = "flex";
    });

    rail?.addEventListener("click", (e) => {
        const btn = e.target.closest(".rail-btn");
        if (!btn) return;
        const panelId = btn.dataset.panel;
        if (!panelId) return;

        const isOpen = drawer?.classList.contains("open");
        const currentActive = rail.querySelector(".rail-btn.active")?.dataset?.panel;

        if (isOpen && currentActive === panelId) closeDrawer();
        else showPanel(panelId);
    });

    closeBtn?.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && drawer?.classList.contains("open")) closeDrawer();
    });

    // start closed
    closeDrawer();
})();

(function () {
    /* ==========================================================
       Floating Details + Overlay relocation (Legend/Metrics)
       index_leftRail.html only
    ========================================================== */
    const cy = window.cy;
    if (!cy) return;

    const EMPTY_PHRASE = "Click a node or relationship.";
    const $ = (id) => document.getElementById(id);

    function ensureOverlayContainers() {
        const wrap = $("canvas-wrap") || cy.container()?.parentElement || cy.container();
        if (!wrap) return null;

        let legendOverlay = $("legendOverlay");
        if (!legendOverlay) {
            legendOverlay = document.createElement("div");
            legendOverlay.id = "legendOverlay";
            legendOverlay.className = "onx-corner";
            legendOverlay.setAttribute("aria-label", "Legend overlay");
            Object.assign(legendOverlay.style, { top: "12px", right: "12px", alignItems: "flex-end" });
            wrap.appendChild(legendOverlay);
        }

        let metricsOverlay = $("metricsOverlay");
        if (!metricsOverlay) {
            metricsOverlay = document.createElement("div");
            metricsOverlay.id = "metricsOverlay";
            metricsOverlay.className = "onx-corner";
            metricsOverlay.setAttribute("aria-label", "Metrics overlay");
            Object.assign(metricsOverlay.style, { right: "12px", bottom: "12px", alignItems: "flex-end" });
            wrap.appendChild(metricsOverlay);
        }

        let float = $("onxFloatDetails");
        if (!float) {
            float = document.createElement("div");
            float.id = "onxFloatDetails";
            float.setAttribute("aria-label", "Floating details");
            float.innerHTML = `
        <div class="onx-fd-top">
          <button class="onx-fd-close" type="button" title="Close" aria-label="Close">✕</button>
        </div>
        <div class="onx-fd-body" id="onxFloatDetailsBody"></div>
      `;
            wrap.appendChild(float);
        }

        float.querySelector(".onx-fd-close")?.addEventListener("click", () => hideFloat());
        return { wrap, legendOverlay, metricsOverlay, float };
    }

    const dom = ensureOverlayContainers();
    if (!dom) return;

    function relocateLegendAndMetrics() {
        const legend = $("legend");
        const metrics = $("metrics");
        const controls = $("legendControls");

        if (legend && legend.parentElement !== dom.legendOverlay) dom.legendOverlay.appendChild(legend);
        if (metrics && metrics.parentElement !== dom.metricsOverlay) dom.metricsOverlay.appendChild(metrics);

        if (controls) {
            const edgeCb = $("toggleEdgeLabels");
            const nodeCb = $("toggleNodeLabels");

            const edgeLabel = edgeCb?.closest("label");
            const nodeLabel = nodeCb?.closest("label");

            controls.style.display = (edgeCb || nodeCb) ? "flex" : "none";

            if (edgeLabel && edgeLabel.parentElement !== controls) controls.appendChild(edgeLabel);
            if (nodeLabel && nodeLabel.parentElement !== controls) controls.appendChild(nodeLabel);

            if (!edgeLabel && edgeCb && edgeCb.parentElement !== controls) {
                const l = document.createElement("label");
                l.appendChild(edgeCb);
                l.appendChild(document.createTextNode(" Show edge labels"));
                controls.appendChild(l);
            }
            if (!nodeLabel && nodeCb && nodeCb.parentElement !== controls) {
                const l = document.createElement("label");
                l.appendChild(nodeCb);
                l.appendChild(document.createTextNode(" Show node labels"));
                controls.appendChild(l);
            }
        }
    }

    relocateLegendAndMetrics();
    cy.on("layoutstop", relocateLegendAndMetrics);
    cy.on("add remove", relocateLegendAndMetrics);

    // Floating details anchored to selection
    const float = $("onxFloatDetails");
    const floatBody = $("onxFloatDetailsBody");
    let anchor = null;
    let lastHtml = "";

    function isEmptyDetails(html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = String(html ?? "");
        const t = (tmp.textContent ?? "").trim();
        return !t || t === EMPTY_PHRASE;
    }

    function showFloat(html) {
        if (!float || !floatBody) return;
        if (isEmptyDetails(html)) { hideFloat(); return; }
        lastHtml = String(html ?? "");
        floatBody.innerHTML = lastHtml;
        float.style.display = "block";
        positionFloat();
    }

    function hideFloat() {
        if (!float || !floatBody) return;
        float.style.display = "none";
        floatBody.innerHTML = "";
        lastHtml = "";
        anchor = null;
    }

    function anchorRenderedPoint() {
        if (!anchor || !anchor.nonempty?.() || !anchor.nonempty()) return null;
        if (typeof anchor.isNode === "function" && anchor.isNode()) return anchor.renderedPosition();
        if (typeof anchor.isEdge === "function" && anchor.isEdge()) {
            const s = anchor.source()?.renderedPosition?.();
            const t = anchor.target()?.renderedPosition?.();
            if (!s || !t) return null;
            return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
        }
        return null;
    }

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function positionFloat() {
        if (!float || float.style.display === "none") return;
        const pt = anchorRenderedPoint();
        if (!pt) return;

        const host = cy.container();
        if (!host) return;
        const hostRect = host.getBoundingClientRect();

        float.style.left = "0px";
        float.style.top = "0px";

        const w = float.offsetWidth || 280;
        const h = float.offsetHeight || 140;
        const pad = 12;
        const dx = 16;
        const dy = -10;

        let left = pt.x + dx;
        let top = pt.y + dy;

        if (left + w > hostRect.width - pad) left = pt.x - w - dx;
        if (left < pad) left = pad;

        top = clamp(top, pad, hostRect.height - h - pad);

        float.style.left = `${Math.round(left)}px`;
        float.style.top = `${Math.round(top)}px`;
    }

    function debounce(fn, ms) {
        let t = 0;
        return function () {
            clearTimeout(t);
            t = setTimeout(() => fn(), ms);
        };
    }

    const positionFloatDebounced = debounce(positionFloat, 20);
    cy.on("pan zoom", positionFloatDebounced);
    window.addEventListener("resize", positionFloatDebounced);

    cy.on("tap", (evt) => {
        if (evt.target === cy) hideFloat();
    });

    // HARD HOOK: drive float from cy taps (robust)
    (function hookCyTapForFloat() {
        if (cy.__onxFloatTapHooked) return;
        cy.__onxFloatTapHooked = true;

        const _updateNode = window.updateDetailsForNode?.bind(window);
        const _updateEdge = window.updateDetailsForEdge?.bind(window);

        cy.on("tap", "node", (evt) => {
            try {
                anchor = evt.target;
                if (_updateNode) _updateNode(evt.target);

                if (!lastHtml || isEmptyDetails(lastHtml)) {
                    const d = evt.target.data();
                    showFloat(
                        `<b>${d.displayLabel ?? d.id}</b><br>` +
                        `Type: ${d.nodeType ?? "-"}<br>` +
                        `Category: ${d.category ?? d.revitCategory ?? "-"}<br>` +
                        `Level: ${d.level ?? "-"}`
                    );
                }
                positionFloat();
            } catch (e) {
                console.error("onx float node tap failed", e);
            }
        });

        cy.on("tap", "edge", (evt) => {
            try {
                anchor = evt.target;
                if (_updateEdge) _updateEdge(evt.target);

                if (!lastHtml || isEmptyDetails(lastHtml)) {
                    const d = evt.target.data();
                    showFloat(
                        `<b>${d.displayType ?? d.type ?? "Relation"}</b><br>` +
                        `Dimension: ${d.dimension ?? "-"}<br>` +
                        `Phase: ${(d.phase ?? []).join(", ")}<br>` +
                        `Owner: ${d.owner ?? "-"}<br>` +
                        `Confidence: ${d.confidence ?? "-"}<br>` +
                        `Risk: ${d.risk ?? "-"}`
                    );
                }
                positionFloat();
            } catch (e) {
                console.error("onx float edge tap failed", e);
            }
        });
    })();

    // Wrap existing core detail functions (no core edits)
    const origSetDetailsMessage = window.setDetailsMessage?.bind(window);
    if (origSetDetailsMessage) {
        window.setDetailsMessage = function (html) {
            origSetDetailsMessage(html);
            showFloat(html);
        };
    }

    const origUpdateNode = window.updateDetailsForNode?.bind(window);
    if (origUpdateNode) {
        window.updateDetailsForNode = function (node) {
            anchor = node;
            origUpdateNode(node);
            positionFloat();
        };
    }

    const origUpdateEdge = window.updateDetailsForEdge?.bind(window);
    if (origUpdateEdge) {
        window.updateDetailsForEdge = function (edge) {
            anchor = edge;
            origUpdateEdge(edge);
            positionFloat();
        };
    }

    // boot mirror
    const bootDetails = $("details")?.innerHTML;
    if (bootDetails && !isEmptyDetails(bootDetails)) showFloat(bootDetails);

    setTimeout(() => {
        relocateLegendAndMetrics();
        window.buildRelationshipLegend?.();
        window.updateMetrics?.();
    }, 120);
})();