/* =========================================
 ONEXUS – Left Rail -> Compact Popover (Filter/Style/Anim)
 FIXES:
  - NEVER destroy panels (no innerHTML="") -> Style/Anim keep working
  - Popover positioned to the RIGHT and bottom-aligned to the pill stack
  - Avoid minimap overlap via ONEXUS.ui.positionPopover()
 Requires: graph-ui.popoverPositioner.js
========================================= */
(function () {
    const rail = document.getElementById("leftRail");
    if (!rail) return;

    const PANELS = ["panelRelationshipIntelligence", "panelFilter", "panelStyle", "panelAnim"];
    const TITLES = {
        panelRelationshipIntelligence: "Relationship Intelligence",
        panelFilter: "Filter / Lens",
        panelStyle: "Style",
        panelAnim: "Animation",
    };

    function ensurePopoverCss() {
        if (document.getElementById("onx-tool-pop-css")) return;
        const st = document.createElement("style");
        st.id = "onx-tool-pop-css";
        st.textContent = `
#onx-tool-pop{
  width: 360px;
  max-width: min(360px, calc(100vw - 40px));
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.10);
  background: rgba(255,255,255,0.86);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 12px 28px rgba(0,0,0,0.18);
  padding: 10px 10px 12px;
  z-index: 10080;
}
:root.theme-dark #onx-tool-pop{
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(15,17,21,0.72);
  box-shadow: 0 12px 28px rgba(0,0,0,0.35);
}
#onx-tool-pop .onx-pop-head{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  margin-bottom:8px;
}
#onx-tool-pop .onx-pop-title{
  font-size:12px; font-weight:900; letter-spacing:.02em;
  color: var(--text-main);
}
#onx-tool-pop .onx-pop-x{
  width:28px; height:28px; border-radius:10px;
  border:1px solid var(--stroke);
  background: var(--btn-bg);
  cursor:pointer;
  color: var(--text-main);
}
#onx-tool-pop .onx-pop-x:hover{ background: var(--btn-bg-hover); }
#onx-tool-pop .onx-pop-body{
  max-height: calc(100vh - 120px);
  overflow:auto;
  padding-right: 2px;
}

/* tighten existing panel visuals a bit */
#onx-tool-pop h3{ margin: 10px 0 6px; }
#onx-tool-pop button.flat{ margin: 4px 0; }
`;
        document.head.appendChild(st);
    }

    function ensureStash() {
        let stash = document.getElementById("onx-tool-panel-stash");
        if (stash) return stash;
        stash = document.createElement("div");
        stash.id = "onx-tool-panel-stash";
        stash.style.display = "none";
        document.body.appendChild(stash);
        return stash;
    }

    function ensurePanelPopover() {
        let pop = document.getElementById("onx-tool-pop");
        if (pop) return pop;

        pop = document.createElement("div");
        pop.id = "onx-tool-pop";
        pop.style.display = "none";
        pop.style.position = "fixed"; // positioned by positioner

        pop.innerHTML = `
  <div class="onx-pop-head">
    <div class="onx-pop-title" id="onx-tool-pop-title">Panel</div>
    <button class="onx-pop-x" id="onx-tool-pop-x" type="button" aria-label="Close">✕</button>
  </div>
  <div class="onx-pop-body" id="onx-tool-pop-body"></div>
`;
        document.body.appendChild(pop);

        pop.querySelector("#onx-tool-pop-x").addEventListener("click", () => closePopover());

        // outside click closes
        document.addEventListener("click", (e) => {
            if (pop.style.display === "none") return;
            const railHit = e.target.closest?.("#leftRail .rail-btn");
            if (pop.contains(e.target) || railHit) return;
            closePopover();
        });

        // ESC closes
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closePopover();
        });

        return pop;
    }

    function closePopover() {
        const pop = document.getElementById("onx-tool-pop");
        if (!pop) return;

        // Move current panel back to stash (DO NOT delete)
        const body = document.getElementById("onx-tool-pop-body");
        const stash = ensureStash();
        if (body && body.firstElementChild) {
            stash.appendChild(body.firstElementChild);
        }

        pop.style.display = "none";
        pop.___panelId = null;

        // clear active state
        rail.querySelectorAll(".rail-btn").forEach((b) => b.classList.remove("active"));
    }

    function openPopover(panelId, anchorEl) {
        ensurePopoverCss();
        const pop = ensurePanelPopover();
        const stash = ensureStash();

        const title = document.getElementById("onx-tool-pop-title");
        const body = document.getElementById("onx-tool-pop-body");

        const panel = document.getElementById(panelId);
        if (!panel) return;

        // If another panel is currently inside body, stash it
        if (body.firstElementChild && body.firstElementChild !== panel) {
            stash.appendChild(body.firstElementChild);
        }

        // Move requested panel into body (no destruction)
        body.replaceChildren(panel);
        panel.style.display = "block";

        title.textContent = TITLES[panelId] ?? "Panel";
        pop.style.display = "block";
        pop.___panelId = panelId;

        // Align with bottom of stack for consistent look with Layer/Nodes
        const stack = document.getElementById("onx-float-left-stack") || rail.parentElement;
        window.ONEXUS?.ui?.positionPopover?.(pop, {
            anchorEl,
            stackEl: stack,
            mode: "stackBottom",
            preferRight: true,
            avoidMinimap: true,
        });
    }

    function toggle(panelId, btn) {
        const pop = document.getElementById("onx-tool-pop");
        const isOpen = pop && pop.style.display !== "none";
        const same = pop && pop.___panelId === panelId;

        if (isOpen && same) {
            closePopover();
            return;
        }

        openPopover(panelId, btn);

        // active state
        rail.querySelectorAll(".rail-btn").forEach((b) =>
            b.classList.toggle("active", b === btn)
        );
    }

    // Reposition on resize if open
    window.addEventListener("resize", () => {
        const pop = document.getElementById("onx-tool-pop");
        if (!pop || pop.style.display === "none") return;
        const btn = rail.querySelector(".rail-btn.active");
        if (!btn) return;
        const stack = document.getElementById("onx-float-left-stack") || rail.parentElement;
        window.ONEXUS?.ui?.positionPopover?.(pop, {
            anchorEl: btn,
            stackEl: stack,
            mode: "stackBottom",
            preferRight: true,
            avoidMinimap: true,
        });
    });

    // Wire clicks
    rail.addEventListener("click", (e) => {
        const btn = e.target.closest(".rail-btn");
        if (!btn) return;
        const panelId = btn.dataset.panel;
        if (!panelId || !PANELS.includes(panelId)) return;
        toggle(panelId, btn);
    });
})();
