/* =========================================================
 ONEXUS – Mobile Toolbar Controller
 - On mobile: hide #fileInput + .iconbar in toolbar
 - Inject "Load" button to trigger file picker
 - Inject "More" button -> popover containing iconbar + View/Theme + Samples slot
========================================================= */
(function () {
    const mqlCoarse = window.matchMedia && window.matchMedia("(pointer: coarse)");
    const mqlNarrow = window.matchMedia && window.matchMedia("(max-width: 820px)");

    function isMobile() {
        return !!(mqlCoarse && mqlCoarse.matches) || !!(mqlNarrow && mqlNarrow.matches);
    }

    function $(id) { return document.getElementById(id); }

    function ensureBtn(id, text) {
        let b = $(id);
        if (b) return b;
        b = document.createElement("button");
        b.id = id;
        b.type = "button";
        b.className = "onx-tb-btn";
        b.textContent = text;
        return b;
    }

    function ensureMorePopover() {
        let pop = $("onx-toolbar-more");
        if (pop) return pop;

        pop = document.createElement("div");
        pop.id = "onx-toolbar-more";
        pop.innerHTML = `
      <div class="head">
        <div class="title">Menu</div>
        <button class="x" id="onx-toolbar-more-x" type="button" aria-label="Close">✕</button>
      </div>

      <div class="sec" id="onx-toolbar-more-primary"></div>

      <div class="sec">
        <div style="font-size:11px;font-weight:900;color:var(--text-muted);margin-bottom:8px;">Actions</div>
        <div class="icongrid" id="onx-toolbar-more-icons"></div>
      </div>

      <div class="sec" id="onx-toolbar-more-samples"></div>
    `;
        document.body.appendChild(pop);

        pop.querySelector("#onx-toolbar-more-x").addEventListener("click", () => toggleMore(false));

        // Outside click closes
        document.addEventListener("click", (e) => {
            if (pop.style.display === "none") return;
            const hitBtn = e.target.closest?.("#onx-btn-more");
            if (pop.contains(e.target) || hitBtn) return;
            toggleMore(false);
        });

        // ESC closes
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") toggleMore(false);
        });

        return pop;
    }

    function toggleMore(show) {
        const pop = ensureMorePopover();
        pop.style.display = (show === undefined) ? (pop.style.display === "none" ? "block" : "none") : (show ? "block" : "none");
    }

    // Move an element into a host (preserving listeners)
    function moveEl(el, host) {
        if (!el || !host) return;
        if (el.parentElement !== host) host.appendChild(el);
    }

    // Create a simple row for moved selects
    function wrapSelectRow(title, el) {
        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "92px 1fr";
        row.style.alignItems = "center";
        row.style.gap = "10px";
        row.style.marginBottom = "8px";
        const lab = document.createElement("div");
        lab.textContent = title;
        lab.style.fontSize = "11px";
        lab.style.fontWeight = "900";
        lab.style.color = "var(--text-muted)";
        row.appendChild(lab);
        row.appendChild(el);
        return row;
    }

    function ensureMobileToolbar() {
        const toolbar = $("toolbar");
        if (!toolbar) return;

        // If not mobile: clean up (do nothing destructive)
        if (!isMobile()) return;

        // Inject Load + More buttons at the end of toolbar
        const loadBtn = ensureBtn("onx-btn-load", "Load");
        const moreBtn = ensureBtn("onx-btn-more", "More");

        // Only append once
        if (!loadBtn.__onxHooked) {
            loadBtn.__onxHooked = true;
            loadBtn.addEventListener("click", () => {
                const inp = $("fileInput");
                if (!inp) return;
                inp.value = "";
                inp.click();
            });
        }
        if (!moreBtn.__onxHooked) {
            moreBtn.__onxHooked = true;
            moreBtn.addEventListener("click", () => {
                buildMoreContent();
                toggleMore();
            });
        }

        if (!toolbar.contains(loadBtn)) toolbar.appendChild(loadBtn);
        if (!toolbar.contains(moreBtn)) toolbar.appendChild(moreBtn);

        // Build popover once
        ensureMorePopover();
    }

    function buildMoreContent() {
        const pop = ensureMorePopover();
        const hostPrimary = pop.querySelector("#onx-toolbar-more-primary");
        const hostIcons = pop.querySelector("#onx-toolbar-more-icons");

        hostPrimary.innerHTML = "";
        hostIcons.innerHTML = "";

        // Move View + Theme selects into popover (mobile only)
        const layoutSel = $("layoutSelect");
        const themeSel = $("themeSelect");

        if (layoutSel) hostPrimary.appendChild(wrapSelectRow("View", layoutSel));
        if (themeSel) hostPrimary.appendChild(wrapSelectRow("Theme", themeSel));

        // Clone iconbar buttons into grid (keep original handlers by dispatching clicks)
        const iconbar = document.querySelector(".iconbar");
        if (iconbar) {
            const buttons = Array.from(iconbar.querySelectorAll("button.icon-btn"));
            buttons.forEach((btn, idx) => {
                const proxy = btn.cloneNode(true);
                proxy.id = ""; // avoid duplicate IDs
                proxy.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    btn.click();         // run original handler
                });
                hostIcons.appendChild(proxy);
            });
        }

        // Samples block is filled by graph-ui.samples.js (if loaded)
        const samplesHost = pop.querySelector("#onx-toolbar-more-samples");
        if (samplesHost && !samplesHost.__onxSamplesStub) {
            samplesHost.__onxSamplesStub = true;
            samplesHost.innerHTML = `
        <div style="font-size:11px;font-weight:900;color:var(--text-muted);margin-bottom:8px;">Samples</div>
        <div id="onx-samples-slot"></div>
      `;
        }
    }

    function boot() {
        ensureMobileToolbar();
        // Re-apply after other scripts might move DOM
        setTimeout(ensureMobileToolbar, 120);
        setTimeout(ensureMobileToolbar, 450);

        // Rebuild on resize/orientation
        window.addEventListener("resize", () => {
            if (!isMobile()) return;
            ensureMobileToolbar();
        });
        window.addEventListener("orientationchange", () => {
            setTimeout(() => { if (isMobile()) ensureMobileToolbar(); }, 120);
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
})();