/* =========================================================
 ONEXUS – Layer Widget (floating icon + popover)
 - Bottom-left, stacked under minimap
 - Shows current layer, quick actions, and background tint indicator
 - Depends on: window.getLayerMode, window.setLayerMode, window.ONEXUS_LAYERS, window.__onexus_state
========================================================= */
(function () {
    const $ = (id) => document.getElementById(id);
    const cy = window.cy;

    function ensureHost() {
        const wrap = $("canvas-wrap") || $("cy")?.parentElement;
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
        const mm = $("minimap");
        if (!mm) return;

        if (mm.parentElement === stack) return;

        // Minimap is positioned absolute in CSS. Move into stack and make it flow.
        stack.insertBefore(mm, stack.firstChild);
        mm.style.position = "relative";
        mm.style.left = "auto";
        mm.style.bottom = "auto";
        mm.style.top = "auto";
        mm.style.right = "auto";
        mm.style.marginBottom = "10px";
    }

    function ensureWidget(stack) {
        let fab = $("onx-layer-fab");
        let pop = $("onx-layer-pop");

        if (!fab) {
            fab = document.createElement("button");
            fab.id = "onx-layer-fab";
            fab.type = "button";
            fab.title = "Layer";
            fab.setAttribute("aria-label", "Layer");
            fab.innerHTML = `
        <span class="onx-layer-dot" aria-hidden="true"></span>
        <span class="onx-layer-fab-text">Layer</span>
      `;
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

          <div class="onx-layer-row">
            <div class="onx-layer-k">Quick</div>
            <div class="onx-layer-actions">
              <button class="onx-layer-btn" id="onx-layer-next" type="button">Next</button>
              <button class="onx-layer-btn" id="onx-layer-reset" type="button">Reset view</button>
            </div>
          </div>

          <div class="onx-layer-row">
            <div class="onx-layer-k">Switch</div>
            <select class="onx-layer-select" id="onx-layer-select"></select>
          </div>

          <div class="onx-layer-row">
            <div class="onx-layer-k">Tint</div>
            <div class="onx-layer-v"><span class="onx-layer-swatch" id="onx-layer-swatch"></span></div>
          </div>

          <div class="onx-layer-note" id="onx-layer-note"></div>
        </div>
      `;
            stack.appendChild(pop);
        }

        return { fab, pop };
    }

    function layerList() {
        const layers = window.ONEXUS_LAYERS || {};
        const keys = Object.keys(layers);
        if (!keys.length) return ["relationship"];
        // stable default order if present
        const preferred = ["relationship", "lifecycle", "risk", "option"];
        const ordered = [
            ...preferred.filter((k) => keys.includes(k)),
            ...keys.filter((k) => !preferred.includes(k)).sort(),
        ];
        return ordered;
    }

    function getLayerTitle(key) {
        const layers = window.ONEXUS_LAYERS || {};
        const cfg = layers[key];
        const lang = window.__onexus_state?.language || "en";
        return cfg?.title?.[lang] || cfg?.title?.en || key;
    }

    function readCssVar(name) {
        try {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        } catch {
            return "";
        }
    }

    function render() {
        const cur = window.getLayerMode?.() || window.__onexus_state?.layerMode || "relationship";
        const title = getLayerTitle(cur);

        const titleEl = $("onx-layer-title");
        const curEl = $("onx-layer-current");
        const noteEl = $("onx-layer-note");
        const swatch = $("onx-layer-swatch");

        if (titleEl) titleEl.textContent = title;
        if (curEl) curEl.textContent = cur;

        // Minimal description (extend per layer later)
        const noteMap = {
            relationship: "Semantic relationships (System/Spatial/Responsibility/Vendor).",
            lifecycle: "Lifecycle view (phase-aware labels/tint).",
            risk: "Risk & confidence emphasis (tint + highlights).",
            option: "Design options (GD/decision-centric view).",
        };
        if (noteEl) noteEl.textContent = noteMap[cur] || "";

        if (swatch) {
            const tint = readCssVar("--bg-canvas");
            swatch.style.background = tint || "#ffffff";
        }

        // Update FAB accent dot color from CSS var
        const dot = document.querySelector("#onx-layer-fab .onx-layer-dot");
        if (dot) {
            const accent = readCssVar("--onx-layer-accent");
            dot.style.background = accent || "#2563eb";
        }
    }

    function populateSelect() {
        const sel = $("onx-layer-select");
        if (!sel) return;
        const cur = window.getLayerMode?.() || window.__onexus_state?.layerMode || "relationship";
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
        const cur = window.getLayerMode?.() || window.__onexus_state?.layerMode || "relationship";
        const list = layerList();
        const idx = Math.max(0, list.indexOf(cur));
        const next = list[(idx + 1) % list.length];
        window.setLayerMode?.(next);
    }

    function togglePopover(show) {
        const pop = $("onx-layer-pop");
        if (!pop) return;
        const want = (show === undefined) ? (pop.style.display === "none") : !!show;
        pop.style.display = want ? "block" : "none";
        if (want) {
            populateSelect();
            render();
        }
    }

    function hookUi() {
        const fab = $("onx-layer-fab");
        const pop = $("onx-layer-pop");
        const close = $("onx-layer-x");
        const btnNext = $("onx-layer-next");
        const btnReset = $("onx-layer-reset");

        if (fab && !fab.__hooked) {
            fab.__hooked = true;
            fab.addEventListener("click", () => togglePopover());
        }

        if (close && !close.__hooked) {
            close.__hooked = true;
            close.addEventListener("click", () => togglePopover(false));
        }

        if (btnNext && !btnNext.__hooked) {
            btnNext.__hooked = true;
            btnNext.addEventListener("click", () => nextLayer());
        }

        if (btnReset && !btnReset.__hooked) {
            btnReset.__hooked = true;
            btnReset.addEventListener("click", () => window.resetView?.());
        }

        // click outside closes
        if (!document.__onxLayerOutsideHooked) {
            document.__onxLayerOutsideHooked = true;
            document.addEventListener("click", (e) => {
                const popEl = $("onx-layer-pop");
                const fabEl = $("onx-layer-fab");
                if (!popEl || popEl.style.display === "none") return;
                if (popEl.contains(e.target) || fabEl?.contains(e.target)) return;
                togglePopover(false);
            });
        }

        // ESC closes popover
        if (!document.__onxLayerEscHooked) {
            document.__onxLayerEscHooked = true;
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") togglePopover(false);
            });
        }
    }

    function hookLayerEvents() {
        // When layer changes, re-render widget
        try {
            window.ONEXUS?.bus?.on?.("layerModeChanged", () => {
                populateSelect();
                render();
            });
        } catch { /* noop */ }

        // When language changes, update titles (your app doesn’t emit language event today)
        // So we also refresh on layoutstop/add/remove as cheap sync points.
        if (cy && !cy.__onxLayerWidgetHooked) {
            cy.__onxLayerWidgetHooked = true;
            cy.on("layoutstop add remove", () => render());
        }
    }

    function boot() {
        const host = ensureHost();
        if (!host) return;

        const stack = ensureStackContainer(host);
        moveMinimapIntoStack(stack);
        ensureWidget(stack);

        hookUi();
        hookLayerEvents();
        populateSelect();
        render();
    }

    // boot once DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        setTimeout(boot, 0);
    }
})();