/* ONEXUS – Node Visibility Widget (floating left pill + popover)
 - FIX: defines window.ONEXUS_NODEVIS (was missing) -> categories list now populates
 - Categories always computed from ALL nodes (cy.nodes())
 - Applies node hide via class: .onx-hide-node-vis (already styled in onexus-style.js)
 - Syncs edges by endpoints via class: .onx-hide-end
 - Integrates "Hide orphan nodes when edge filters active" by delegating to ONEXUS_FILTERS
*/
(function () {
    const $ = (id) => document.getElementById(id);
    const cy = window.cy;

    // ---- guards ----
    if (!cy) return;

    // ---- constants ----
    const HIDE_NODE_VIS = "onx-hide-node-vis";
    const HIDE_ENDS = "onx-hide-end";
    const LS_HIDDEN = "onexus.nodevis.hiddenCategories";

    // ---- hidden categories state (persisted) ----
    function loadHiddenSet() {
        try {
            const raw = localStorage.getItem(LS_HIDDEN);
            const arr = JSON.parse(raw || "[]");
            return new Set(Array.isArray(arr) ? arr.map(String) : []);
        } catch {
            return new Set();
        }
    }
    function saveHiddenSet(set) {
        try {
            localStorage.setItem(LS_HIDDEN, JSON.stringify([...set]));
        } catch { }
    }
    const hiddenCats = loadHiddenSet();

    // ---- helpers ----
    const catOf = (n) => String(n.data("category") ?? n.data("revitCategory") ?? "Uncategorized");

    function syncEdgesByEndpointsHard() {
        // Pass 0: clear endpoint-hide to avoid "sticky" edges
        cy.edges().removeClass(HIDE_ENDS);

        // Pass 1: compute based on CURRENT visibility
        cy.edges().forEach((e) => {
            const ok = e.source().visible() && e.target().visible();
            if (!ok) e.addClass(HIDE_ENDS);
        });

        // Pass 2 (delayed): visibility can settle one tick later after class/style recalcs
        setTimeout(() => {
            cy.edges().removeClass(HIDE_ENDS);
            cy.edges().forEach((e) => {
                const ok = e.source().visible() && e.target().visible();
                if (!ok) e.addClass(HIDE_ENDS);
            });
        }, 60);
    }

    function applyCategoryVisibility() {
        // apply node visibility by category
        cy.nodes().forEach((n) => {
            const cat = catOf(n);
            if (hiddenCats.has(cat)) n.addClass(HIDE_NODE_VIS);
            else n.removeClass(HIDE_NODE_VIS);
        });

        // sync edges (do not bypass filter/layer hides; this is additive)
        syncEdgesByEndpointsHard();

        // refresh downstream UI
        if (window.___onxNodeVisSkipUi) return;
        window.buildRelationshipLegend?.();
        window.updateMetrics?.();
        // keep focus fading consistent if active
        if (window.___onexus_state?.focusedNode) window.applyDepthFocus?.(window.___onexus_state.focusedNode);
    }

    // ---- API expected by widget ----
    window.ONEXUS_NODEVIS = window.ONEXUS_NODEVIS ?? {};
    window.ONEXUS_NODEVIS.getHiddenCategories = () => new Set(hiddenCats);
    window.ONEXUS_NODEVIS.toggleCategoryVisible = (category, visible) => {
        const cat = String(category ?? "Uncategorized");
        if (visible) hiddenCats.delete(cat);
        else hiddenCats.add(cat);
        saveHiddenSet(hiddenCats);
        applyCategoryVisibility();
    };

    // Integrate "Hide orphan nodes when edge filters active"
    window.ONEXUS_NODEVIS.getHideIsolatedNodes = () => window.ONEXUS_FILTERS?.getHideIsolatedNodes?.() ?? true;
    window.ONEXUS_NODEVIS.setHideIsolatedNodes = (enabled) => {
        window.ONEXUS_FILTERS?.setHideIsolatedNodes?.(!!enabled);
        // no-op here; filter module handles orphan hiding itself
        window.buildRelationshipLegend?.();
        window.updateMetrics?.();
    };

    // ---- UI widget ----
    function ensureHost() {
        const wrap = $("canvas-wrap") ?? $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        return wrap;
    }
    function ensureBottomStack(host) {
        let stack = $("onx-float-left-stack");
        if (stack) return stack;
        stack = document.createElement("div");
        stack.id = "onx-float-left-stack";
        host.appendChild(stack);
        return stack;
    }
    function ensureCssOnce() {
        if ($("onx-nodevis-widget-css")) return;
        const st = document.createElement("style");
        st.id = "onx-nodevis-widget-css";
        st.textContent = `
#onx-nodevis-fab{
  display:inline-flex; align-items:center; gap:8px;
  height:36px; padding:0 10px; border-radius:999px;
  border:1px solid var(--stroke);
  background: rgba(255,255,255,0.78);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-sm);
  cursor:pointer; user-select:none;
  pointer-events:auto;
}
:root.theme-dark #onx-nodevis-fab{ background: rgba(15,17,21,0.55); }
#onx-nodevis-fab:hover{ background: var(--btn-bg-hover); }
:root.theme-dark #onx-nodevis-fab:hover{ background: rgba(255,255,255,0.08); }
#onx-nodevis-fab .dot{ width:12px;height:12px;border-radius:999px;background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.18); }
#onx-nodevis-fab .txt{ font-size:12px;font-weight:900;color:var(--text-main); }

#onx-nodevis-pop{
  width: 300px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.10);
  background: rgba(255,255,255,0.86);
  backdrop-filter: blur(10px);
  box-shadow: 0 12px 28px rgba(0,0,0,0.18);
  padding: 10px 10px 12px;
  display:none;
  pointer-events:auto;
}
:root.theme-dark #onx-nodevis-pop{
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(15,17,21,0.72);
  box-shadow: 0 12px 28px rgba(0,0,0,0.35);
}
.onx-nv-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.onx-nv-title{ font-size:12px; font-weight:900; letter-spacing:.02em; }
.onx-nv-x{
  width:28px; height:28px; border-radius:10px;
  border:1px solid var(--stroke);
  background: var(--btn-bg); cursor:pointer;
}
.onx-nv-x:hover{ background: var(--btn-bg-hover); }
.onx-nv-row{ display:flex; align-items:center; gap:8px; font-size:11px; color: var(--text-muted); margin: 4px 0 8px; user-select:none; }
.onx-nv-row input{ width:14px; height:14px; accent-color:#2563eb; }
.onx-nv-search{
  width:100%;
  padding:6px 8px;
  border-radius:10px;
  border:1px solid var(--stroke);
  background: transparent;
  color: var(--text-main);
  font-size: 12px;
  margin-bottom:8px;
}
.onx-nv-list{
  max-height: 240px;
  overflow:auto;
  border:1px solid var(--stroke);
  border-radius:10px;
  padding: 6px 8px;
}
.onx-nv-item{
  display:flex; align-items:center; justify-content:space-between;
  gap:10px; padding:4px 2px; border-radius:8px;
}
.onx-nv-item:hover{ background: rgba(0,0,0,.04); }
:root.theme-dark .onx-nv-item:hover{ background: rgba(255,255,255,.06); }
.onx-nv-item label{ display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; font-size:12px; color: var(--text-main); }
.onx-nv-count{ font-size:11px; color: var(--text-muted); border:1px solid var(--stroke); border-radius:999px; padding:1px 8px; background: rgba(255,255,255,.55); }
:root.theme-dark .onx-nv-count{ background: rgba(15,17,21,.35); }
`;
        document.head.appendChild(st);
    }
    function ensureWidget(stack) {
        ensureCssOnce();
        let fab = $("onx-nodevis-fab");
        let pop = $("onx-nodevis-pop");

        if (!fab) {
            fab = document.createElement("button");
            fab.id = "onx-nodevis-fab";
            fab.type = "button";
            fab.innerHTML = `<span class="dot"></span><span class="txt">Nodes</span>`;
            stack.appendChild(fab);
        }
        if (!pop) {
            pop = document.createElement("div");
            pop.id = "onx-nodevis-pop";
            pop.innerHTML = `
                <div class="onx-nv-head">
                <div class="onx-nv-title">Node Visibility</div>
                <button id="onx-nodevis-x" class="onx-nv-x" type="button" aria-label="Close">✕</button>
                </div>
                <div class="onx-nv-row">
                <label>
                    <input id="onx-nodevis-hideIso" type="checkbox" />
                    Hide orphan nodes when edge filters active
                </label>
                </div>
                <input id="onx-nodevis-search" class="onx-nv-search" type="text" placeholder="Search categories…" />
                <div id="onx-nodevis-list" class="onx-nv-list"></div>
                `;
            stack.appendChild(pop);
        }
        return { fab, pop };
    }

    function listCategoriesWithCounts() {
        const map = new Map();
        cy.nodes().forEach((n) => {
            const cat = catOf(n);
            map.set(cat, (map.get(cat) ?? 0) + 1);
        });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }

    function render() {
        const api = window.ONEXUS_NODEVIS;
        if (!api) return;

        const chk = $("onx-nodevis-hideIso");
        if (chk) chk.checked = !!api.getHideIsolatedNodes?.();

        const q = ($("onx-nodevis-search")?.value ?? "").trim().toLowerCase();
        const hidden = api.getHiddenCategories?.() ?? new Set();
        const list = $("onx-nodevis-list");
        if (!list) return;

        list.innerHTML = "";
        for (const [cat, count] of listCategoriesWithCounts()) {
            if (q && !cat.toLowerCase().includes(q)) continue;

            const row = document.createElement("div");
            row.className = "onx-nv-item";

            const left = document.createElement("label");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !hidden.has(cat);
            cb.addEventListener("change", () => {
                api.toggleCategoryVisible?.(cat, cb.checked);
                setTimeout(render, 0);
            });

            const name = document.createElement("span");
            name.textContent = cat;

            const badge = document.createElement("span");
            badge.className = "onx-nv-count";
            badge.textContent = String(count);

            left.appendChild(cb);
            left.appendChild(name);
            row.appendChild(left);
            row.appendChild(badge);
            list.appendChild(row);
        }
    }

    function togglePopover(show) {
        const pop = document.getElementById("onx-nodevis-pop");
        const fab = document.getElementById("onx-nodevis-fab");
        if (!pop || !fab) return;

        const want = (show === undefined) ? (pop.style.display === "none") : !!show;

        pop.style.display = want ? "block" : "none";

        if (!want) return;

        // Always rebuild UI on open (fix empty lists after load)
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

        // Reposition once after layout settles (fonts/scrollbars can change height)
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

    function hook() {
        const host = ensureHost();
        if (!host) return;
        const stack = ensureBottomStack(host);
        const { fab } = ensureWidget(stack);

        if (!fab.___hooked) {
            fab.___hooked = true;
            fab.addEventListener("click", () => togglePopover());
        }
        const x = $("onx-nodevis-x");
        if (x && !x.___hooked) {
            x.___hooked = true;
            x.addEventListener("click", () => togglePopover(false));
        }
        const chk = $("onx-nodevis-hideIso");
        if (chk && !chk.___hooked) {
            chk.___hooked = true;
            chk.addEventListener("change", () => window.ONEXUS_NODEVIS?.setHideIsolatedNodes?.(chk.checked));
        }
        const s = $("onx-nodevis-search");
        if (s && !s.___hooked) {
            s.___hooked = true;
            s.addEventListener("input", () => render());
        }

        // close on outside click
        if (!document.___onxNodeVisOutsideHooked) {
            document.___onxNodeVisOutsideHooked = true;
            document.addEventListener("click", (e) => {
                const pop = $("onx-nodevis-pop");
                const fab = $("onx-nodevis-fab");
                if (!pop || pop.style.display === "none") return;
                if (pop.contains(e.target) || fab?.contains(e.target)) return;
                togglePopover(false);
            });
        }

        // apply persisted hidden categories after loads / edits
        const deb = (() => {
            let t = 0;
            return () => {
                clearTimeout(t);
                t = setTimeout(() => applyCategoryVisibility(), 60);
            };
        })();
        if (!cy.___onxNodeVisStateHooked) {
            cy.___onxNodeVisStateHooked = true;
            cy.on("add remove layoutstop", deb);
        }

        // initial apply (silent UI refresh during boot)
        window.___onxNodeVisSkipUi = true;
        applyCategoryVisibility();
        window.___onxNodeVisSkipUi = false;
    }

    function closeOtherPops(exceptId) {
        ["onx-layer-pop", "onx-nodevis-pop"].forEach(id => {
            if (id === exceptId) return;
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook);
    else setTimeout(hook, 0);
})();