/* =========================================================
 ONEXUS – Lifecycle Layer Controller (usable phase workflow)
 Update:
 - Panel does NOT auto-open on entering lifecycle
 - Panel open/close is controlled via Layer widget actions
 - Dark theme handled via CSS (#onx-lifecycle-panel selectors)

 Requires:
 - window.cy
 - window.getLayerMode / window.setLayerMode
 - CSS: ".layer-hide { display:none }" exists
========================================================= */
(function () {
    const cy = window.cy;
    if (!cy) return;

    const PREF = {
        phase: "onexus.lifecycle.phase",
        mode: "onexus.lifecycle.mode", // exact | cumulative
        hideIso: "onexus.lifecycle.hideIsolated",
        showUnphased: "onexus.lifecycle.showUnphased",
        playMs: "onexus.lifecycle.playMs",
        panelOpen: "onexus.lifecycle.panelOpen"
    };

    const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
    const writePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { } };

    const state = {
        active: false,
        phases: [],
        phase: null,
        mode: readPref(PREF.mode, "exact"), // exact|cumulative
        hideIsolated: readPref(PREF.hideIso, "1") !== "0",
        showUnphased: readPref(PREF.showUnphased, "1") !== "0",
        playMs: Math.max(120, parseInt(readPref(PREF.playMs, "650"), 10) || 650),
        playing: false,
        panelOpen: readPref(PREF.panelOpen, "0") === "1",
        _timer: 0
    };

    // ---------- phase utilities ----------
    const normalizePhase = (p) => String(p ?? "").trim();

    function computePhases() {
        const meta = window.__onexus_meta ?? {};
        const fromMeta = Array.isArray(meta.phases) ? meta.phases.map(normalizePhase).filter(Boolean) : [];
        if (fromMeta.length) return Array.from(new Set(fromMeta));

        const set = new Set();
        cy.edges().forEach(e => {
            const ph = e.data("phase");
            if (Array.isArray(ph)) ph.forEach(x => { const s = normalizePhase(x); if (s) set.add(s); });
            else if (ph != null) { const s = normalizePhase(ph); if (s) set.add(s); }
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }

    function phaseIndex(p) {
        const i = state.phases.indexOf(p);
        return i >= 0 ? i : -1;
    }

    function pickInitialPhase() {
        const saved = normalizePhase(readPref(PREF.phase, ""));
        if (saved && state.phases.includes(saved)) return saved;
        return state.phases[0] ?? null;
    }

    // ---------- DOM: floating panel in bottom-left stack ----------
    function ensureHost() {
        const wrap = document.getElementById("canvas-wrap") || cy.container()?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        return wrap;
    }

    function ensureStack(host) {
        let stack = document.getElementById("onx-float-left-stack");
        if (stack) return stack;

        stack = document.createElement("div");
        stack.id = "onx-float-left-stack";
        Object.assign(stack.style, {
            position: "absolute",
            left: "12px",
            bottom: "12px",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            pointerEvents: "none",
        });
        host.appendChild(stack);
        return stack;
    }

    function ensurePanel() {
        const host = ensureHost();
        if (!host) return null;
        const stack = ensureStack(host);

        let panel = document.getElementById("onx-lifecycle-panel");
        if (panel) return panel;

        panel = document.createElement("div");
        panel.id = "onx-lifecycle-panel";
        panel.style.pointerEvents = "auto";
        panel.style.display = "none"; // controlled via open/close
        panel.style.width = "320px";
        panel.style.maxWidth = "min(320px, calc(100vw - 40px))";
        panel.style.borderRadius = "12px";
        panel.style.padding = "10px 10px 12px";
        panel.style.color = "var(--text-main)";

        panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.02em;">Lifecycle</div>
        <button id="lc-close" type="button"
          style="width:28px;height:28px;border-radius:10px;border:1px solid var(--stroke);background:var(--btn-bg);cursor:pointer;">✕</button>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <button id="lc-prev" type="button"
          style="padding:5px 10px;border-radius:999px;border:1px solid var(--stroke);background:var(--btn-bg);cursor:pointer;">◀</button>
        <select id="lc-phase"
          style="flex:1;font-size:12px;padding:6px 8px;border-radius:10px;border:1px solid var(--stroke);background:transparent;color:var(--text-main);">
        </select>
        <button id="lc-next" type="button"
          style="padding:5px 10px;border-radius:999px;border:1px solid var(--stroke);background:var(--btn-bg);cursor:pointer;">▶</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;font-size:11px;color:var(--text-muted);">
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input id="lc-cum" type="checkbox" style="width:14px;height:14px;accent-color:#0ea5e9;"> Cumulative
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input id="lc-iso" type="checkbox" style="width:14px;height:14px;accent-color:#0ea5e9;"> Hide isolated
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input id="lc-unph" type="checkbox" style="width:14px;height:14px;accent-color:#0ea5e9;"> Show unphased
        </label>
      </div>

      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
        <button id="lc-play" type="button"
          style="padding:5px 10px;border-radius:999px;border:1px solid var(--stroke);background:var(--btn-bg);cursor:pointer;">Play</button>
        <button id="lc-stop" type="button"
          style="padding:5px 10px;border-radius:999px;border:1px solid var(--stroke);background:var(--btn-bg);cursor:pointer;display:none;">Stop</button>
      </div>

      <div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.35;">
        Open/close this panel from the Layer widget actions.
      </div>
    `;

        // Insert above layer widget FAB if present
        const layerFab = document.getElementById("onx-layer-fab");
        if (layerFab && layerFab.parentElement === stack) stack.insertBefore(panel, layerFab);
        else stack.appendChild(panel);

        // events
        panel.querySelector("#lc-close").addEventListener("click", () => closePanel());
        panel.querySelector("#lc-prev").addEventListener("click", () => step(-1));
        panel.querySelector("#lc-next").addEventListener("click", () => step(+1));
        panel.querySelector("#lc-phase").addEventListener("change", (e) => setPhase(e.target.value));
        panel.querySelector("#lc-cum").addEventListener("change", (e) => {
            state.mode = e.target.checked ? "cumulative" : "exact";
            writePref(PREF.mode, state.mode);
            apply();
        });
        panel.querySelector("#lc-iso").addEventListener("change", (e) => {
            state.hideIsolated = !!e.target.checked;
            writePref(PREF.hideIso, state.hideIsolated ? "1" : "0");
            apply();
        });
        panel.querySelector("#lc-unph").addEventListener("change", (e) => {
            state.showUnphased = !!e.target.checked;
            writePref(PREF.showUnphased, state.showUnphased ? "1" : "0");
            apply();
        });
        panel.querySelector("#lc-play").addEventListener("click", () => play());
        panel.querySelector("#lc-stop").addEventListener("click", () => stop());

        return panel;
    }

    function isOpen() {
        const panel = document.getElementById("onx-lifecycle-panel");
        return !!panel && panel.style.display !== "none";
    }

    function openPanel() {
        const panel = ensurePanel();
        if (!panel) return (false);
        panel.style.display = "block";
        state.panelOpen = true;
        writePref(PREF.panelOpen, "1");
        renderPanel();
        return true;
    }

    function closePanel() {
        const panel = ensurePanel();
        if (!panel) return (false);
        panel.style.display = "none";
        state.panelOpen = false;
        writePref(PREF.panelOpen, "0");
        return true;
    }

    function togglePanel() {
        return isOpen() ? closePanel() : openPanel();
    }

    function renderPanel() {
        const panel = ensurePanel();
        if (!panel) return;

        const sel = panel.querySelector("#lc-phase");
        const cum = panel.querySelector("#lc-cum");
        const iso = panel.querySelector("#lc-iso");
        const unph = panel.querySelector("#lc-unph");

        sel.innerHTML = "";
        (state.phases.length ? state.phases : ["(no phases)"]).forEach(p => {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            sel.appendChild(opt);
        });

        if (state.phase && state.phases.includes(state.phase)) sel.value = state.phase;
        else sel.value = state.phases[0] ?? "(no phases)";

        cum.checked = (state.mode === "cumulative");
        iso.checked = !!state.hideIsolated;
        unph.checked = !!state.showUnphased;

        const playBtn = panel.querySelector("#lc-play");
        const stopBtn = panel.querySelector("#lc-stop");
        if (state.playing) { playBtn.style.display = "none"; stopBtn.style.display = "inline-block"; }
        else { playBtn.style.display = "inline-block"; stopBtn.style.display = "none"; }
    }

    // ---------- filtering (additive class) ----------
    function clearLifecycleHides() {
        cy.edges().removeClass("layer-hide");
        cy.nodes().removeClass("layer-hide");
    }

    function shouldShowEdge(edge, activePhase) {
        const ph = edge.data("phase");
        if (ph == null || (Array.isArray(ph) && ph.length === 0)) return !!state.showUnphased;

        const list = Array.isArray(ph) ? ph.map(normalizePhase).filter(Boolean) : [normalizePhase(ph)].filter(Boolean);
        if (!list.length) return !!state.showUnphased;

        if (state.mode === "exact") return list.includes(activePhase);

        const ai = phaseIndex(activePhase);
        if (ai < 0) return false;
        for (const p of list) {
            const pi = phaseIndex(p);
            if (pi >= 0 && pi <= ai) return true;
        }
        return false;
    }

    function hideIsolatedNodesByVisibleEdges() {
        if (!state.hideIsolated) {
            cy.nodes().removeClass("layer-hide");
            return;
        }
        const keep = new Set();
        cy.edges().not(".layer-hide").forEach(e => {
            keep.add(e.data("source"));
            keep.add(e.data("target"));
        });
        cy.nodes().forEach(n => {
            if (keep.has(n.id())) n.removeClass("layer-hide");
            else n.addClass("layer-hide");
        });
    }

    function apply() {
        if (!state.active) return;

        const phase = state.phase;
        if (!phase) {
            clearLifecycleHides();
            window.updateMetrics?.();
            window.buildRelationshipLegend?.();
            return;
        }

        // Lifecycle wants phase-first; clear relationship/dimension filters if present
        window.showAllEdges?.();

        cy.edges().forEach(e => {
            const show = shouldShowEdge(e, phase);
            if (show) e.removeClass("layer-hide");
            else e.addClass("layer-hide");
        });

        hideIsolatedNodesByVisibleEdges();

        window.buildRelationshipLegend?.();
        window.updateMetrics?.();
    }

    // ---------- stepping / playback ----------
    function setPhase(p) {
        const phase = normalizePhase(p);
        if (!phase || !state.phases.includes(phase)) return;
        state.phase = phase;
        writePref(PREF.phase, phase);
        apply();
        window.showTransientMessage?.(`Lifecycle: ${phase}${state.mode === "cumulative" ? " (cumulative)" : ""}`);
    }

    function step(delta) {
        if (!state.phases.length || !state.phase) return;
        const i = phaseIndex(state.phase);
        const ni = Math.max(0, Math.min(state.phases.length - 1, i + delta));
        setPhase(state.phases[ni]);
    }

    function play() {
        if (state.playing) return;
        if (!state.phases.length) return;

        state.playing = true;
        renderPanel();

        let idx = Math.max(0, phaseIndex(state.phase ?? state.phases[0]));
        const tick = () => {
            if (!state.playing) return;
            setPhase(state.phases[idx]);
            idx = (idx + 1) % state.phases.length;
            state._timer = setTimeout(tick, state.playMs);
        };
        tick();
    }

    function stop() {
        state.playing = false;
        clearTimeout(state._timer);
        state._timer = 0;
        renderPanel();
    }

    // ---------- lifecycle enter/exit ----------
    function enterLifecycle() {
        state.active = true;

        state.phases = computePhases();
        state.phase = pickInitialPhase();

        // AUTO-FALLBACK: lifecycle with no phases is not usable -> return to relationship
        if (!state.phases.length) {
            window.showTransientMessage?.("Lifecycle: no phases found — switching back to Relationship");
            try { window.setLayerMode?.("relationship", { persist: true }); } catch { }
            state.active = false;
            closePanel();
            return;
        }

        // Do NOT auto-open panel; leave it to Layer widget action
        ensurePanel();
        renderPanel();

        if (state.phase) apply();

        // Default view for lifecycle exploration
        window.applyLayout?.("dependency_flow");

        // Restore panel open state if user previously left it open
        if (state.panelOpen) openPanel();
        else closePanel();
    }

    function exitLifecycle() {
        stop();
        state.active = false;
        closePanel();
        clearLifecycleHides();
        window.buildRelationshipLegend?.();
        window.updateMetrics?.();
    }

    function onLayerChange({ prev, next }) {
        if (next === "lifecycle") enterLifecycle();
        else if (prev === "lifecycle") exitLifecycle();
    }

    // Listen to layer changes
    try { window.ONEXUS?.bus?.on?.("layerModeChanged", onLayerChange); } catch { }

    // Reapply on graph change
    const debounced = (() => {
        let t = 0;
        return () => {
            clearTimeout(t);
            t = setTimeout(() => {
                if (!state.active) return;
                state.phases = computePhases();
                if (!state.phases.length) {
                    window.setLayerMode?.("relationship", { persist: true });
                    return;
                }
                if (!state.phase || !state.phases.includes(state.phase)) state.phase = pickInitialPhase();
                renderPanel();
                apply();
            }, 120);
        };
    })();

    if (!cy.__onxLifecycleHooked) {
        cy.__onxLifecycleHooked = true;
        cy.on("add remove", debounced);
    }

    // Boot: if lifecycle already active (persisted)
    setTimeout(() => {
        const cur = window.getLayerMode?.() ?? window.__onexus_state?.layerMode ?? "relationship";
        if (cur === "lifecycle") enterLifecycle();
    }, 120);

    // Expose
    window.ONEXUS_LIFECYCLE = {
        enter: enterLifecycle,
        exit: exitLifecycle,
        setPhase,
        step,
        play,
        stop,
        openPanel,
        closePanel,
        togglePanel,
        isOpen,
        getState: () => ({ ...state }),
        recompute: () => { state.phases = computePhases(); renderPanel(); apply(); }
    };
})();