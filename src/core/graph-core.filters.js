/* ONEXUS – Filters + Legend + Metrics + Phase Filter
 Fix:
 - When edge filters are active (type/dimension/phase) in Relationship layer,
   hide orphan nodes (nodes with no visible edges).
 - Robust fallback: also applies inline display:none for orphan nodes.
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  const HIDE_FILTER = "onx-hide-filter";
  const HIDE_ENDS = "onx-hide-end";
  const HIDE_ISOLATED = "onx-hide-isolated";

  let relationshipFilter = null;
  let dimensionFilter = null;
  let phaseFilterSet = new Set();

  const PREF_HIDE_ISOLATED = "onexus.filter.hideIsolatedNodes";
  const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const writePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { } };
  let hideIsolatedNodes = readPref(PREF_HIDE_ISOLATED, "1") !== "0";

  const normStr = (s) => String(s ?? "").trim();
  const getLayer = () => window.getLayerMode?.() ?? state?.layerMode ?? "relationship";

  // ✅ canonical safe escape
  const escapeHtml = (s) => {
    const fn = window.ONEXUS?.util?.escapeHtml;
    return (typeof fn === "function") ? fn(s) : String(s ?? "");
  };

  function anyEdgeFilterActive() {
    return !!relationshipFilter || !!dimensionFilter || (phaseFilterSet?.size ?? 0) > 0;
  }

  function baseEdgesForLegendAndMetrics() {
    return cy.edges().filter(e =>
      !e.hasClass("onx-hide-compare") &&
      !e.hasClass("onx-hide-reveal")
    );
  }

  const syncEdges = (() => {
    const f = () => {
      cy.edges().forEach((e) => {
        const endpointsVisible = e.source().visible() && e.target().visible();
        if (endpointsVisible) e.removeClass(HIDE_ENDS);
        else e.addClass(HIDE_ENDS);
      });
    };
    let t;
    return () => { clearTimeout(t); t = setTimeout(f, 40); };
  })();

  function applyHideIsolatedNodesFromVisibleEdges() {
    const layer = getLayer();
    const enabled = hideIsolatedNodes && layer === "relationship" && anyEdgeFilterActive();

    if (!enabled) {
      cy.nodes().forEach(n => {
        n.removeClass(HIDE_ISOLATED);
        if (n.style("display") === "none") n.style("display", null);
      });
      syncEdges();
      return;
    }

    const keep = new Set();
    cy.edges().forEach(e => {
      if (e.hasClass(HIDE_FILTER)) return;
      if (!e.visible()) return;
      const s = e.source(), t = e.target();
      if (!s.visible() || !t.visible()) return;
      keep.add(s.id());
      keep.add(t.id());
    });

    cy.nodes().forEach(n => {
      const orphan = !keep.has(n.id());
      if (orphan) {
        n.addClass(HIDE_ISOLATED);
        n.style("display", "none");
      } else {
        n.removeClass(HIDE_ISOLATED);
        if (n.style("display") === "none") n.style("display", null);
      }
    });

    syncEdges();

    setTimeout(() => {
      const enabled2 = hideIsolatedNodes && (getLayer() === "relationship") && anyEdgeFilterActive();
      if (!enabled2) return;

      const keep2 = new Set();
      cy.edges().forEach(e => {
        if (e.hasClass(HIDE_FILTER)) return;
        if (!e.visible()) return;
        const s = e.source(), t = e.target();
        if (!s.visible() || !t.visible()) return;
        keep2.add(s.id()); keep2.add(t.id());
      });

      cy.nodes().forEach(n => {
        const orphan = !keep2.has(n.id());
        if (orphan) {
          n.addClass(HIDE_ISOLATED);
          n.style("display", "none");
        } else {
          n.removeClass(HIDE_ISOLATED);
          if (n.style("display") === "none") n.style("display", null);
        }
      });

      syncEdges();
    }, 80);
  }

  function setHideIsolatedNodes(enabled) {
    hideIsolatedNodes = !!enabled;
    writePref(PREF_HIDE_ISOLATED, hideIsolatedNodes ? "1" : "0");
    applyHideIsolatedNodesFromVisibleEdges();
    buildRelationshipLegend();
    updateMetrics();
  }

  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    const cats = [...new Set(
      cy.nodes().map(n => n.data("category") ?? n.data("revitCategory"))
    )].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
    cats.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  function filterByCategory(cat) {
    cy.nodes().forEach(n => {
      const val = n.data("category") ?? n.data("revitCategory");
      const hit = (val === cat);
      if (cat === "ALL" || hit) n.removeClass(HIDE_FILTER);
      else n.addClass(HIDE_FILTER);
    });
    syncEdges();
    applyHideIsolatedNodesFromVisibleEdges();
    if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  // -------- Edge filters (Relationship layer) --------
  function filterByDimension(dim) { dimensionFilter = dim ?? null; applyEdgeFilters(); }
  function filterByRelationshipType(type) { relationshipFilter = (relationshipFilter === type) ? null : type; applyEdgeFilters(); }
  function clearRelationshipFilter() { relationshipFilter = null; applyEdgeFilters(); }

  function showAllEdges() {
    relationshipFilter = null;
    dimensionFilter = null;
    phaseFilterSet.clear();

    // Clear filter hides
    cy.nodes().removeClass(HIDE_FILTER);
    cy.edges().removeClass(HIDE_FILTER);

    // CRITICAL: clear endpoint-hide first; it can remain stuck from prior node hides
    cy.edges().removeClass(HIDE_ENDS);

    // Clear orphan hide (if any) and remove inline display fallback (used by this module)
    cy.nodes().removeClass(HIDE_ISOLATED);
    cy.nodes().forEach(n => {
      // only undo our inline fallback; class-based hides (compare/nodevis/layer) remain
      if (n.style("display") === "none") n.style("display", null);
    });

    // Let Cytoscape apply style changes, then recompute endpoint hiding
    // (timing matters; otherwise visible() can still reflect the old state)
    setTimeout(() => {
      syncEdges(); // debounced internal recompute
      // second pass: fixes “stuck” cases when visibility settles after first tick
      setTimeout(() => {
        cy.edges().removeClass(HIDE_ENDS);
        syncEdges();
        // Orphan hide will be disabled because no edge filter active, but call anyway for consistency
        applyHideIsolatedNodesFromVisibleEdges();
        if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
        buildRelationshipLegend();
        updateMetrics();
      }, 120);
    }, 0);

    buildRelationshipLegend();
    updateMetrics();
  }

  function buildPhaseFilter() {
    const sel = document.getElementById("phaseFilter");
    if (!sel) return;
    const all = new Set();
    cy.edges().forEach((e) => {
      const ph = e.data("phase") ?? [];
      (Array.isArray(ph) ? ph : [ph]).forEach((p) => {
        const s = normStr(p);
        if (s) all.add(s);
      });
    });
    const options = [...all].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = "";
    options.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
    if (!sel.__onexus_hooked) {
      sel.addEventListener("change", () => {
        const picks = [...sel.selectedOptions].map((o) => o.value);
        filterByPhase(picks);
      });
      sel.__onexus_hooked = true;
    }
  }

  function filterByPhase(phases) {
    phaseFilterSet = new Set((phases ?? []).map(String));
    applyEdgeFilters();
  }

  function applyEdgeFilters() {
    cy.edges().forEach((e) => {
      let vis = true;
      if (dimensionFilter) vis = vis && (e.data("dimension") === dimensionFilter);
      if (relationshipFilter) vis = vis && (e.data("type") === relationshipFilter);
      if (phaseFilterSet.size) {
        const ph = e.data("phase") ?? [];
        const list = Array.isArray(ph) ? ph : [ph];
        vis = vis && list.some((p) => phaseFilterSet.has(String(p)));
      }
      if (vis) e.removeClass(HIDE_FILTER);
      else e.addClass(HIDE_FILTER);
    });

    syncEdges();
    applyHideIsolatedNodesFromVisibleEdges();

    if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  // =========================================================
  // Legend (relationship/lifecycle/risk/option) - keep existing behavior
  // =========================================================
  function clearLegend(container) { container.innerHTML = ""; }

  function mkLegendItem({ color, label, count, active, onClick }) {
    const item = document.createElement("div");
    item.className = "legend-item";
    if (active) item.classList.add("active");
    const line = document.createElement("div");
    line.className = "legend-line";
    line.style.backgroundColor = color ?? "#999";
    const text = document.createElement("span");
    text.textContent = label ?? "";
    item.appendChild(line);
    item.appendChild(text);
    if (typeof count === "number") {
      const badge = document.createElement("span");
      badge.className = "legend-count";
      badge.textContent = String(count);
      item.appendChild(badge);
    }
    if (typeof onClick === "function") item.addEventListener("click", onClick);
    return item;
  }

  function buildLegendRelationship(container) {
    clearLegend(container);

    // IMPORTANT: build legend from ALL relevant edges (not only :visible),
    // so legend doesn't collapse into a dead-end after filtering.
    const edgesAll = baseEdgesForLegendAndMetrics();

    // --- NEW: always-visible reset item ---
    const hasAnyFilter =
      !!relationshipFilter || !!dimensionFilter || (phaseFilterSet?.size ?? 0) > 0;

    const totalVisible = cy.edges(":visible").length;
    container.appendChild(
      mkLegendItem({
        color: "#64748b",
        label: hasAnyFilter ? "All (reset)" : "All",
        count: totalVisible,
        active: !hasAnyFilter,
        onClick: () => window.showAllEdges?.(),
      })
    );

    // small visual separation
    const sep = document.createElement("div");
    sep.style.height = "6px";
    container.appendChild(sep);

    // Single pass over the full edge set: collect types + a sample edge each.
    // (Previously this ran a full :visible[type=...] query AND a full filter()
    //  per type — O(types × edges); now it's O(edges).)
    const sampleByType = new Map();
    edgesAll.forEach((e) => {
      const t = e.data("type");
      if (t && !sampleByType.has(t)) sampleByType.set(t, e);
    });

    // Single pass over visible edges to tally counts per type.
    const visibleCountByType = new Map();
    cy.edges(":visible").forEach((e) => {
      const t = e.data("type");
      if (t) visibleCountByType.set(t, (visibleCountByType.get(t) ?? 0) + 1);
    });

    // Sort for stable UI
    const sorted = [...sampleByType.keys()].sort((a, b) => String(a).localeCompare(String(b)));

    sorted.forEach((type) => {
      const visibleCount = visibleCountByType.get(type) ?? 0;

      // Stable color from a sample edge of that type (even if hidden)
      const sample = sampleByType.get(type);
      const color = sample ? sample.style("line-color") : "#999";

      // Use displayType if available
      const displayType = sample?.data("displayType") ?? type;

      container.appendChild(
        mkLegendItem({
          color,
          label: displayType,
          count: visibleCount,
          active: relationshipFilter === type,
          onClick: () => window.filterByRelationshipType?.(type),
        })
      );
    });
  }

  function buildLegendLifecycle(container) {
    clearLegend(container);
    const metaPhases = window.__onexus_meta?.phases;
    const edges = baseEdgesForLegendAndMetrics();

    const phaseSet = new Set();
    edges.forEach((e) => {
      const ph = e.data("phase");
      const list = Array.isArray(ph) ? ph : (ph != null ? [ph] : []);
      list.map(normStr).filter(Boolean).forEach(p => phaseSet.add(p));
    });

    const phases = Array.isArray(metaPhases) && metaPhases.length
      ? metaPhases.map(normStr).filter(Boolean)
      : [...phaseSet].sort((a, b) => a.localeCompare(b));

    const cur = window.ONEXUS_LIFECYCLE?.getState?.()?.phase ?? null;
    const hint = document.createElement("div");
    hint.className = "legend-hint";
    hint.textContent = "Phases (click to set)";
    container.appendChild(hint);

    phases.forEach((p) => {
      const count = edges.filter((e) => {
        const ph = e.data("phase");
        const list = Array.isArray(ph) ? ph : (ph != null ? [ph] : []);
        return list.map(normStr).includes(p);
      }).length;
      container.appendChild(mkLegendItem({
        color: "#0ea5e9",
        label: p,
        count,
        active: (cur === p),
        onClick: () => window.ONEXUS_LIFECYCLE?.setPhase?.(p),
      }));
    });
  }

  function buildLegendRisk(container) {
    clearLegend(container);
    const edges = baseEdgesForLegendAndMetrics();
    const runtime = window.ONEXUS_LAYER?.runtime ?? window.__onexus_layerRuntime ?? {};
    const cur = runtime.riskFilter ?? "all";

    let high = 0, inferred = 0;
    edges.forEach((e) => {
      const r = String(e.data("risk") ?? "").trim().toLowerCase();
      if (r === "high" || r === "h" || r === "3") high++;
      const conf = String(e.data("confidence") ?? "").trim().toLowerCase();
      if (conf === "inferred") inferred++;
    });

    const hint = document.createElement("div");
    hint.className = "legend-hint";
    hint.textContent = "Risk (click to filter)";
    container.appendChild(hint);

    container.appendChild(mkLegendItem({
      color: "#ef4444", label: "High", count: high, active: (cur === "high"),
      onClick: () => window.ONEXUS_LAYER?.setRiskFilter?.(cur === "high" ? "all" : "high"),
    }));

    container.appendChild(mkLegendItem({
      color: "#64748b", label: "Inferred confidence", count: inferred, active: (cur === "inferred"),
      onClick: () => window.ONEXUS_LAYER?.setRiskFilter?.(cur === "inferred" ? "all" : "inferred"),
    }));
  }

  function buildLegendOption(container) {
    clearLegend(container);
    const runtime = window.ONEXUS_LAYER?.runtime ?? window.__onexus_layerRuntime ?? {};
    const cur = runtime.optionFilter ?? "all";

    const hint = document.createElement("div");
    hint.className = "legend-hint";
    hint.textContent = "Options (click to select)";
    container.appendChild(hint);

    const optNodes = cy.nodes().filter(n =>
      String(n.data("nodeType") ?? "").toLowerCase() === "option" ||
      String(n.data("category") ?? "").toLowerCase() === "designoption"
    );

    container.appendChild(mkLegendItem({
      color: "#6366f1",
      label: "Options only",
      count: optNodes.length,
      active: (cur === "optionsOnly"),
      onClick: () => window.ONEXUS_LAYER?.setOptionFilter?.(cur === "optionsOnly" ? "all" : "optionsOnly"),
    }));
  }

  const buildRelationshipLegend = (() => {
    const f = () => {
      const container = document.getElementById("legend");
      if (!container) return;
      const layer = getLayer();
      if (layer === "lifecycle") return buildLegendLifecycle(container);
      if (layer === "risk") return buildLegendRisk(container);
      if (layer === "option") return buildLegendOption(container);
      return buildLegendRelationship(container);
    };
    let t;
    return () => { clearTimeout(t); t = setTimeout(f, 80); };
  })();

  // =========================================================
  // Metrics (keep your existing module if you want; minimal here)
  // =========================================================
  function metricsRow(k, v) {
    return `<div class="onx-metrics-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`;
  }

  function updateMetrics() {
    const box = document.getElementById("metrics");
    if (!box) return;
    const tn = cy.nodes().length, vn = cy.nodes(":visible").length;
    const te = cy.edges().length, ve = cy.edges(":visible").length;
    const density = vn > 1 ? (ve / (vn * (vn - 1))).toFixed(3) : "0";
    const filters = [];
    if (dimensionFilter) filters.push(`dim=${dimensionFilter}`);
    if (relationshipFilter) filters.push(`type=${relationshipFilter}`);
    if (phaseFilterSet.size) filters.push(`phase=${[...phaseFilterSet].join(", ")}`);
    const ftxt = filters.length ? filters.join(" · ") : "none";
    box.innerHTML = `<div class="onx-metrics-wrap">
      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Graph</div>
        ${metricsRow("Nodes (visible/total)", `${vn} / ${tn}`)}
        ${metricsRow("Edges (visible/total)", `${ve} / ${te}`)}
        ${metricsRow("Density (visible)", `${density}`)}
      </div>
      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Filters</div>
        ${metricsRow("Active", ftxt)}
      </div>
    </div>`;
  }

  // expose
  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;
  window.filterByDimension = filterByDimension;
  window.filterByRelationshipType = filterByRelationshipType;
  window.clearRelationshipFilter = clearRelationshipFilter;
  window.showAllEdges = showAllEdges;
  window.buildPhaseFilter = buildPhaseFilter;
  window.filterByPhase = filterByPhase;
  window.buildRelationshipLegend = buildRelationshipLegend;
  window.updateMetrics = updateMetrics;

  // orphan control for widgets
  window.ONEXUS_FILTERS = {
    setHideIsolatedNodes,
    getHideIsolatedNodes: () => hideIsolatedNodes,
    applyHideIsolatedNodesFromVisibleEdges
  };

  // re-apply orphan hide after graph edits/loads
  if (cy && !cy.__onxOrphanHooked) {
    cy.__onxOrphanHooked = true;
    const deb = (fn, ms = 120) => { let t = 0; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
    const refresh = deb(() => applyHideIsolatedNodesFromVisibleEdges(), 120);
    cy.on("add remove layoutstop", refresh);
  }
})();