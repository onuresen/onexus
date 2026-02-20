/* =========================================================
 ONEXUS – Layer Widget (floating pill + popover)
 FIX (Option 1): Popover opens to the RIGHT of the bottom-left stack
 - avoids overlap with minimap/top-left UI
 Depends on: getLayerMode, setLayerMode, ONEXUS_LAYERS, __onexus_state
========================================================= */
(function () {
    const $ = (id) => document.getElementById(id);
    const cy = window.cy;

    function ensureHost() {
        const wrap = $("canvas-wrap") ?? $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        return wrap;
    }

    function ensureStackContainer(host) {
        let stack = $("onx-float-left-stack");
        if (stack) return stack;
        stack = document.createElement("div");
        stack.id = "onx-float-left-stack";
        stack.setAttribute("aria-label", "Floating tools (left bottom)");
        host.appendChild(stack);
        return stack;
    }

    function moveMinimapIntoStack(stack) {
        // legacy behavior; your other scripts may move minimap elsewhere.
        const mm = $("minimap");
        if (!mm) return;
        if (mm.parentElement === stack) return;
        stack.insertBefore(mm, stack.firstChild);
        Object.assign(mm.style, {
            position: "relative",
            left: "auto",
            bottom: "auto",
            top: "auto",
            right: "auto",
            marginBottom: "10px",
        });
    }

    function ensureWidget(stack) {
        // Make stack a positioning context for right-opening popover
        if (getComputedStyle(stack).position === "static") stack.style.position = "relative";

        let fab = $("onx-layer-fab");
        let pop = $("onx-layer-pop");

        if (!fab) {
            fab = document.createElement("button");
            fab.id = "onx-layer-fab";
            fab.type = "button";
            fab.title = "Layer";
            fab.setAttribute("aria-label", "Layer");
            // Keep markup minimal; CSS from onexus-common.css styles this pill. [5](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-core.io.export.js)
            fab.innerHTML = `<span class="onx-layer-dot"></span><span class="onx-layer-fab-text">Layer</span>`;
            stack.appendChild(fab);
        }

        if (!pop) {
            pop = document.createElement("div");
            pop.id = "onx-layer-pop";
            pop.setAttribute("role", "dialog");
            pop.setAttribute("aria-label", "Layer panel");
            pop.style.display = "none";

            pop.innerHTML = `
        <div class="onx-layer-pop-h">
          <div class="onx-layer-title" id="onx-layer-title">Layer</div>
          <button class="onx-layer-x" id="onx-layer-x" type="button" aria-label="Close">✕</button>
        </div>

        <div class="onx-layer-body">
          <div class="onx-layer-row">
            <div class="onx-layer-k">Current</div>
            <div class="onx-layer-v" id="onx-layer-current">relationship</div>
          </div>

          <div class="onx-layer-section">
            <div class="onx-layer-sec-title">Switch</div>
            <select class="onx-layer-select" id="onx-layer-select"></select>
          </div>

          <div class="onx-layer-section">
            <div class="onx-layer-sec-title">Tint</div>
            <span class="onx-layer-swatch" id="onx-layer-swatch"></span>
            <div class="onx-layer-note" id="onx-layer-note"></div>
          </div>

          <div class="onx-layer-section">
            <div class="onx-layer-sec-title">Quick actions</div>
            <div class="onx-layer-actions" id="onx-layer-actions"></div>
          </div>

          <div class="onx-layer-section">
            <div class="onx-layer-sec-title">Utilities</div>
            <div class="onx-layer-actions">
              <button class="onx-layer-btn" id="onx-layer-next" type="button">Next layer</button>
              <button class="onx-layer-btn" id="onx-layer-reset" type="button">Reset view</button>
            </div>
          </div>
        </div>
      `;
            stack.appendChild(pop);
        }

        return { fab, pop };
    }

    function layerList() {
        const layers = window.ONEXUS_LAYERS ?? {};
        const keys = Object.keys(layers);
        if (!keys.length) return ["relationship"];
        const preferred = ["relationship", "lifecycle", "risk", "option"];
        return [
            ...preferred.filter((k) => keys.includes(k)),
            ...keys.filter((k) => !preferred.includes(k)).sort(),
        ];
    }

    function getLayerCfg(key) {
        const layers = window.ONEXUS_LAYERS ?? {};
        return (
            layers[key] ??
            layers.relationship ?? {
                key: "relationship",
                title: { en: "Relationship", jp: "関係" },
                actions: [],
            }
        );
    }

    function getLayerTitle(key) {
        const cfg = getLayerCfg(key);
        const lang = window.__onexus_state?.language ?? "en";
        return cfg?.title?.[lang] ?? cfg?.title?.en ?? key;
    }

    function readCssVar(name) {
        try {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        } catch {
            return "";
        }
    }

    function renderActions() {
        const host = $("onx-layer-actions");
        if (!host) return;

        const cur =
            window.getLayerMode?.() ??
            window.__onexus_state?.layerMode ??
            "relationship";
        const cfg = getLayerCfg(cur);
        const actions = Array.isArray(cfg.actions) ? cfg.actions : [];

        host.innerHTML = "";
        if (!actions.length) {
            const empty = document.createElement("div");
            empty.className = "onx-layer-muted";
            empty.textContent = "No quick actions for this layer.";
            host.appendChild(empty);
            return;
        }

        actions.forEach((a) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "onx-layer-btn";
            btn.textContent =
                typeof a.label === "function" ? a.label() : (a.label ?? a.id ?? "Action");
            btn.title = a.hint ?? "";
            btn.addEventListener("click", () => {
                try {
                    a.run?.({
                        cy,
                        state: window.__onexus_state,
                        layer: cur,
                    });
                } catch (e) {
                    console.error("Layer action failed:", e);
                    window.showTransientMessage?.("Action failed (see console)");
                }
                setTimeout(() => render(), 0);
            });
            host.appendChild(btn);
        });
    }

    function render() {
        const cur =
            window.getLayerMode?.() ??
            window.__onexus_state?.layerMode ??
            "relationship";
        const title = getLayerTitle(cur);

        const titleEl = $("onx-layer-title");
        const curEl = $("onx-layer-current");
        const noteEl = $("onx-layer-note");
        const swatch = $("onx-layer-swatch");

        if (titleEl) titleEl.textContent = title;
        if (curEl) curEl.textContent = cur;

        const noteMap = {
            relationship: "Semantic relationships (System/Spatial/Responsibility/Vendor).",
            lifecycle: "Lifecycle view (phase-aware, timeline semantics).",
            risk: "Risk & confidence emphasis (visual + filtering).",
            option: "Design options (GD/decision-centric).",
        };
        if (noteEl) noteEl.textContent = noteMap[cur] ?? "";

        if (swatch) {
            const tint = readCssVar("--bg-canvas");
            swatch.style.background = tint || "#ffffff";
        }

        const dot = document.querySelector("#onx-layer-fab .onx-layer-dot");
        if (dot) {
            const accent = readCssVar("--onx-layer-accent");
            dot.style.background = accent || "#2563eb";
        }

        renderActions();
    }

    function populateSelect() {
        const sel = $("onx-layer-select");
        if (!sel) return;

        const cur =
            window.getLayerMode?.() ??
            window.__onexus_state?.layerMode ??
            "relationship";
        const list = layerList();

        sel.innerHTML = "";
        list.forEach((k) => {
            const opt = document.createElement("option");
            opt.value = k;
            opt.textContent = getLayerTitle(k);
            if (k === cur) opt.selected = true;
            sel.appendChild(opt);
        });

        sel.onchange = () => window.setLayerMode?.(sel.value);
    }

    function nextLayer() {
        const cur =
            window.getLayerMode?.() ??
            window.__onexus_state?.layerMode ??
            "relationship";
        const list = layerList();
        const idx = Math.max(0, list.indexOf(cur));
        window.setLayerMode?.(list[(idx + 1) % list.length]);
    }

    // --------------------------
    // FIX: position popover to the RIGHT of the stack/pill
    // --------------------------
    function positionPopoverRight() {
        const stack = $("onx-float-left-stack");
        const pop = $("onx-layer-pop");
        const fab = $("onx-layer-fab");
        if (!stack || !pop || !fab) return;

        // Popover is appended inside stack, so absolute positioning is relative to stack
        pop.style.position = "absolute";
        pop.style.left = "calc(100% + 10px)"; // open to the right of pill column
        pop.style.bottom = "0px";             // align to bottom of stack
        pop.style.top = "auto";
        pop.style.right = "auto";
        pop.style.transform = "none";
        pop.style.zIndex = "100";             // above minimap/cards if they overlap

        // Optional: keep within viewport height
        pop.style.maxHeight = "calc(100vh - 24px)";
        pop.style.overflow = "auto";
    }

    function togglePopover(show) {
        const pop = document.getElementById("onx-layer-pop");
        const fab = document.getElementById("onx-layer-fab");
        if (!pop || !fab) return;

        const want = (show === undefined) ? (pop.style.display === "none") : !!show;

        pop.style.display = want ? "block" : "none";

        if (!want) return;

        // Sync content first (so height is correct before positioning)
        try { populateSelect(); } catch { }
        try { render(); } catch { }

        // Position: open RIGHT, bottom-aligned to the pill stack, avoid minimap overlap
        const stack = document.getElementById("onx-float-left-stack") || fab.parentElement;
        const pos = window.ONEXUS?.ui?.positionPopover;
        if (typeof pos === "function") {
            pos(pop, {
                anchorEl: fab,
                stackEl: stack,
                mode: "stackBottom",
                preferRight: true,
                avoidMinimap: true
            });
        }

        // Reposition once after layout settles (content/actions may change height)
        setTimeout(() => {
            const pos2 = window.ONEXUS?.ui?.positionPopover;
            if (typeof pos2 === "function") {
                pos2(pop, {
                    anchorEl: fab,
                    stackEl: stack,
                    mode: "stackBottom",
                    preferRight: true,
                    avoidMinimap: true
                });
            }
        }, 60);
    }

    function hookUi() {
        const fab = $("onx-layer-fab");
        const close = $("onx-layer-x");
        const btnNext = $("onx-layer-next");
        const btnReset = $("onx-layer-reset");

        if (fab && !fab.___hooked) {
            fab.___hooked = true;
            fab.addEventListener("click", () => togglePopover());
        }
        if (close && !close.___hooked) {
            close.___hooked = true;
            close.addEventListener("click", () => togglePopover(false));
        }
        if (btnNext && !btnNext.___hooked) {
            btnNext.___hooked = true;
            btnNext.addEventListener("click", () => nextLayer());
        }
        if (btnReset && !btnReset.___hooked) {
            btnReset.___hooked = true;
            btnReset.addEventListener("click", () => window.resetView?.());
        }

        // click outside closes
        if (!document.___onxLayerOutsideHooked) {
            document.___onxLayerOutsideHooked = true;
            document.addEventListener("click", (e) => {
                const popEl = $("onx-layer-pop");
                const fabEl = $("onx-layer-fab");
                if (!popEl || popEl.style.display === "none") return;
                if (popEl.contains(e.target) || fabEl?.contains(e.target)) return;
                togglePopover(false);
            });
        }

        // ESC closes popover
        if (!document.___onxLayerEscHooked) {
            document.___onxLayerEscHooked = true;
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") togglePopover(false);
            });
        }
    }

    function hookLayerEvents() {
        try {
            window.ONEXUS?.bus?.on?.("layerModeChanged", () => {
                populateSelect();
                render();
            });
        } catch { }

        if (cy && !cy.___onxLayerWidgetHooked) {
            cy.___onxLayerWidgetHooked = true;
            cy.on("layoutstop add remove", () => render());
        }
    }

    function boot() {
        const host = ensureHost();
        if (!host) return;

        const stack = ensureStackContainer(host);

        // NOTE: You likely move minimap to top-left via other modules (floatZones/leftDock). [4](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/layout-leftRail.js)[3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.nodeVisWidget.js)
        // Leaving this call harmless if minimap already moved elsewhere.
        moveMinimapIntoStack(stack);

        ensureWidget(stack);
        hookUi();
        hookLayerEvents();
        populateSelect();
        render();
        positionPopoverRight();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
})();