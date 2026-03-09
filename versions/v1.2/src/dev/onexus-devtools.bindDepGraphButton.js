/* =========================================================
ONEXUS – DevTools menu binder for #btnDepGraph
- Normal click: open menu (no Shift/Alt required)
- Actions:
  - Show DepGraph overlay
  - Export DepGraph JSON
  - Hook Audit (open panel)
  - Export HookGraph JSON (ONEXUS graph)
  - Show Combined overlay
  - Export Combined JSON
  - Show+Export Combined
Safety:
- Does NOT mutate window.cy
- DepGraph overlay uses separate Cytoscape instance (host.___depCy)
- Combined reuses depgraph overlay instance only (safe)
Requires:
- onexus-depgraph.js (ONEXUS_DEPGRAPH.show/build/exportJSON)
- onexus-audit.hooks.js (ONEXUS_HOOK_AUDIT.install/run/exportJSON/buildGraph)
- onexus-devgraph.combine.js (ONEXUS_DEVGRAPH_COMBINE.showCombined/exportCombined/buildCombined)
Optional:
- graph-ui.popoverPositioner.js (ONEXUS.ui.positionPopover)
========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);

  // ------------------------
  // Hook Audit mini panel (same concept as before)
  // ------------------------
  function ensureHookAuditPanel() {
    let pop = $("onx-hook-audit-pop");
    if (pop) return pop;

    pop = document.createElement("div");
    pop.id = "onx-hook-audit-pop";
    pop.style.display = "none";
    pop.style.position = "fixed";
    pop.style.zIndex = "10110";
    pop.style.width = "340px";
    pop.style.maxWidth = "min(340px, calc(100vw - 40px))";
    pop.style.borderRadius = "12px";
    pop.style.border = "1px solid rgba(0,0,0,0.10)";
    pop.style.background = "rgba(255,255,255,0.90)";
    pop.style.backdropFilter = "blur(10px)";
    pop.style.boxShadow = "0 12px 28px rgba(0,0,0,0.20)";
    pop.style.padding = "10px 10px 12px";
    pop.style.fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
    pop.style.color = "#111";

    pop.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:900;letter-spacing:.02em;">Hook Audit</div>
        <button id="onx-hook-audit-x"
          style="width:28px;height:28px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          ✕
        </button>
      </div>

      <div id="onx-hook-audit-body" style="font-size:12px;line-height:1.35;color:#111827;">
        Ready.
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button id="onx-hook-audit-run"
          style="padding:6px 10px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          Run
        </button>
        <button id="onx-hook-audit-export"
          style="padding:6px 10px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          Export JSON
        </button>
      </div>

      <div style="margin-top:8px;font-size:11px;color:#6b7280;line-height:1.35;">
        Exports ONEXUS schema graph (default) or raw report via API.
      </div>
    `;

    document.body.appendChild(pop);

    pop.querySelector("#onx-hook-audit-x").addEventListener("click", () => (pop.style.display = "none"));
    pop.querySelector("#onx-hook-audit-run").addEventListener("click", () => renderHookAuditRun());
    pop.querySelector("#onx-hook-audit-export").addEventListener("click", () =>
      window.ONEXUS_HOOK_AUDIT?.exportJSON?.({ format: "onexus", download: true })
    );

    // outside click closes
    document.addEventListener("click", (e) => {
      if (pop.style.display === "none") return;
      const btn = $("btnDepGraph");
      if (pop.contains(e.target) || btn?.contains(e.target) || $("onx-devmenu")?.contains(e.target)) return;
      pop.style.display = "none";
    });

    return pop;
  }

  function renderHookAuditRun() {
    const body = $("onx-hook-audit-body");
    if (!body) return;

    const out = window.ONEXUS_HOOK_AUDIT?.run?.({ includeStacks: false, topN: 10 });
    if (!out) {
      body.textContent = "Hook audit not available (ONEXUS_HOOK_AUDIT missing).";
      return;
    }

    const cyTop = out.summary?.cyTop?.[0];
    const domTop = out.summary?.domTop?.[0];

    body.innerHTML = `
      <div><b>cy records:</b> ${out.summary.counts.cyRecords}</div>
      <div><b>dom records:</b> ${out.summary.counts.domRecords}</div>
      <div style="margin-top:6px;"><b>Top cy hook:</b> ${cyTop ? `${cyTop.kind} ${cyTop.event} (${cyTop.count})` : "n/a"}</div>
      <div><b>Top dom hook:</b> ${domTop ? `${domTop.target} ${domTop.type} (${domTop.count})` : "n/a"}</div>
      <div style="margin-top:8px;color:#6b7280;font-size:11px;">
        Full details in console (see <code>[ONEXUS HOOK AUDIT]</code>).
      </div>
    `;
  }

  // ------------------------
  // Menu UI
  // ------------------------
  function ensureMenu() {
    let m = $("onx-devmenu");
    if (m) return m;

    m = document.createElement("div");
    m.id = "onx-devmenu";
    m.style.position = "fixed";
    m.style.zIndex = "10120";
    m.style.display = "none";
    m.style.width = "280px";
    m.style.maxWidth = "min(280px, calc(100vw - 40px))";
    m.style.borderRadius = "12px";
    m.style.border = "1px solid rgba(0,0,0,0.10)";
    m.style.background = "rgba(255,255,255,0.92)";
    m.style.backdropFilter = "blur(10px)";
    m.style.boxShadow = "0 12px 28px rgba(0,0,0,0.20)";
    m.style.padding = "8px";
    m.style.fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
    m.style.color = "#111";

    m.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <div style="font-size:12px;font-weight:900;letter-spacing:.02em;">Dev Graph</div>
        <button id="onx-devmenu-x"
          style="width:28px;height:28px;border-radius:10px;border:1px solid var(--stroke,#e5e7eb);background:var(--btn-bg,#fff);cursor:pointer;">
          ✕
        </button>
      </div>
      <div id="onx-devmenu-items" style="display:flex;flex-direction:column;gap:6px;"></div>
    `;

    document.body.appendChild(m);

    $("onx-devmenu-x").addEventListener("click", () => (m.style.display = "none"));

    // outside click closes
    document.addEventListener("click", (e) => {
      if (m.style.display === "none") return;
      const btn = $("btnDepGraph");
      if (m.contains(e.target) || btn?.contains(e.target) || $("onx-hook-audit-pop")?.contains(e.target)) return;
      m.style.display = "none";
    });

    // ESC closes
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && m.style.display !== "none") m.style.display = "none";
    });

    return m;
  }

  function menuBtn(label, hint, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = hint || "";
    Object.assign(b.style, {
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      borderRadius: "10px",
      border: "1px solid var(--stroke,#e5e7eb)",
      background: "var(--btn-bg,#fff)",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 650,
    });
    b.addEventListener("click", async () => {
      try {
        b.disabled = true;
        b.style.opacity = "0.6";
        await onClick();
      } catch (err) {
        console.error("[DevMenu] action failed:", err);
        alert("Dev action failed (see console).");
      } finally {
        b.disabled = false;
        b.style.opacity = "1";
      }
    });
    return b;
  }

  function menuDivider(text) {
    const d = document.createElement("div");
    d.textContent = text || "";
    Object.assign(d.style, {
      marginTop: "8px",
      marginBottom: "4px",
      fontSize: "11px",
      color: "#6b7280",
      fontWeight: 800,
      letterSpacing: ".02em",
      textTransform: "uppercase",
    });
    return d;
  }

  function positionMenuNearButton(menuEl, btnEl) {
    const pos = window.ONEXUS?.ui?.positionPopover;
    if (typeof pos === "function") {
      pos(menuEl, { anchorEl: btnEl, stackEl: btnEl?.parentElement, mode: "anchorBottom", preferRight: false, avoidMinimap: true });
      return;
    }
    const r = btnEl.getBoundingClientRect();
    menuEl.style.left = `${Math.round(Math.max(12, r.left - 10))}px`;
    menuEl.style.top = `${Math.round(Math.min(window.innerHeight - 12 - menuEl.getBoundingClientRect().height, r.bottom + 10))}px`;
  }

  async function openMenu(btn) {
    const m = ensureMenu();
    const items = $("onx-devmenu-items");
    items.innerHTML = "";

    // Quick sanity: install CY hook audit (records future registrations)
    window.ONEXUS_HOOK_AUDIT?.install?.({ dom: false });

    items.appendChild(menuDivider("DepGraph"));
    items.appendChild(
      menuBtn(
        "Show DepGraph overlay",
        "Build + render overlay (separate Cytoscape instance)",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEPGRAPH?.show?.({ includeDom: true, includeSymbols: true });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export DepGraph JSON",
        "Downloads ONEXUS schema JSON",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEPGRAPH?.exportJSON?.({ includeDom: true, includeSymbols: true });
        }
      )
    );

    items.appendChild(menuDivider("Hook Audit"));
    items.appendChild(
      menuBtn(
        "Open Hook Audit panel",
        "Shows mini panel; does not open overlay",
        async () => {
          const pop = ensureHookAuditPanel();
          pop.style.display = "block";
          positionMenuNearButton(pop, btn);
          renderHookAuditRun();
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export HookGraph JSON",
        "Downloads ONEXUS graph built from hook registrations",
        async () => {
          m.style.display = "none";
          window.ONEXUS_HOOK_AUDIT?.exportJSON?.({ format: "onexus", download: true });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export Hook audit RAW",
        "Downloads raw report JSON",
        async () => {
          m.style.display = "none";
          window.ONEXUS_HOOK_AUDIT?.exportJSON?.({ format: "raw", download: true });
        }
      )
    );

    items.appendChild(menuDivider("Combined"));
    items.appendChild(
      menuBtn(
        "Show Combined overlay",
        "DepGraph overlay reused; elements replaced with combined graph",
        async () => {
          m.style.display = "none";
          const C = window.ONEXUS_DEVGRAPH_COMBINE;
          if (C?.showCombined) await C.showCombined({ topN: 25, exportAlso: false });
          else if (window.ONEXUS_DEVGRAPH?.showCombined) await window.ONEXUS_DEVGRAPH.showCombined({ topN: 25, exportAlso: false });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export Combined JSON",
        "Downloads ONEXUS combined graph JSON",
        async () => {
          m.style.display = "none";
          const C = window.ONEXUS_DEVGRAPH_COMBINE;
          if (C?.exportCombined) await C.exportCombined({ topN: 25 });
          else if (window.ONEXUS_DEVGRAPH?.exportCombined) await window.ONEXUS_DEVGRAPH.exportCombined({ topN: 25 });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Show + Export Combined",
        "Shows combined overlay and downloads JSON",
        async () => {
          m.style.display = "none";
          const C = window.ONEXUS_DEVGRAPH_COMBINE;
          if (C?.showCombined) await C.showCombined({ topN: 25, exportAlso: true });
          else if (window.ONEXUS_DEVGRAPH?.showCombined) await window.ONEXUS_DEVGRAPH.showCombined({ topN: 25, exportAlso: true });
        }
      )
    );

    items.appendChild(menuDivider("Snapshot"));
    items.appendChild(
      menuBtn(
        "Export Source Snapshot (1 file)",
        "Downloads a single merged text file of all same-origin JS/CSS loaded",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEV_SNAPSHOT?.exportText?.({ includeJs: true, includeCss: true });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export Source Manifest (JSON)",
        "Downloads JSON manifest of collected assets",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEV_SNAPSHOT?.exportManifest?.({ includeJs: true, includeCss: true });
        }
      )
    );

    items.appendChild(menuDivider("Snapshot (./src/**)"));
    items.appendChild(
      menuBtn(
        "Export ./src bundle (1 file)",
        "Pick project root → exports ONE merged text bundle of ./src/**",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEV_SRCTREE?.exportBundle?.({ subdir: "src" });
        }
      )
    );
    items.appendChild(
      menuBtn(
        "Export ./src manifest (JSON)",
        "Pick project root → exports manifest JSON",
        async () => {
          m.style.display = "none";
          await window.ONEXUS_DEV_SRCTREE?.exportManifest?.({ subdir: "src" });
        }
      )
    );

    // show + position
    m.style.display = "block";
    positionMenuNearButton(m, btn);
    // settle pass
    setTimeout(() => positionMenuNearButton(m, btn), 60);
  }

  function boot() {
    const btn = $("btnDepGraph");
    if (!btn || btn.___onxDevMenuBound) return;
    btn.___onxDevMenuBound = true;

    // Intercept normal click and open menu; no shift/alt behavior needed.
    // Prevent other depgraph hookToolbarButton listeners from firing.
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openMenu(btn);
      },
      true
    );
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();