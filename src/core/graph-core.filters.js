/* ONEXUS – Filters + Legend + Metrics + Phase Filter
   Layer-aware:
   - relationship: edge types legend + core metrics
   - lifecycle: phases legend + lifecycle metrics block
   - risk: risk buckets legend + risk metrics block
   - option: option nodes legend + option metrics block
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  const HIDE_FILTER = "onx-hide-filter";
  const HIDE_ENDS = "onx-hide-end";

  let relationshipFilter = null; // edge.type
  let dimensionFilter = null;    // edge.dimension
  let phaseFilterSet = new Set();// selected phases (relationship layer filter)

  // ---- small helpers ----
  const uniq = (arr) => [...new Set(arr)];
  const normStr = (s) => String(s ?? "").trim();
  const getLayer = () => window.getLayerMode?.() ?? state?.layerMode ?? "relationship";
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));

  // Exclude compare/reveal hides so legend/metrics remain informative in those modes
  function baseEdgesForLegendAndMetrics() {
    return cy.edges().filter(e =>
      !e.hasClass("onx-hide-compare") &&
      !e.hasClass("onx-hide-reveal")
    );
  }

  // -------- Category filter --------
  function buildCategoryFilter() {
    const select = document.getElementById("categoryFilter");
    if (!select) return;
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    const cats = [...new Set(
      cy.nodes().map((n) => n.data("category") ?? n.data("revitCategory"))
    )].filter(Boolean).sort();

    cats.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  function filterByCategory(cat) {
    cy.nodes().forEach((n) => {
      const val = n.data("category") ?? n.data("revitCategory");
      const hit = (val === cat);
      if (cat === "ALL" || hit) n.removeClass(HIDE_FILTER);
      else n.addClass(HIDE_FILTER);
    });

    syncEdges();
    if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  // -------- Edge filters (relationship layer filters) --------
  function filterByDimension(dim) {
    dimensionFilter = dim ?? null;
    applyEdgeFilters();
  }

  function filterByRelationshipType(type) {
    relationshipFilter = (relationshipFilter === type) ? null : type;
    applyEdgeFilters();
  }

  function clearRelationshipFilter() {
    relationshipFilter = null;
    applyEdgeFilters();
  }

  function showAllEdges() {
    relationshipFilter = null;
    dimensionFilter = null;
    phaseFilterSet.clear();

    // Clear only filter-level hiding; do NOT touch layer-hide or other modes.
    cy.nodes().removeClass(HIDE_FILTER);
    cy.edges().removeClass(HIDE_FILTER);

    syncEdges();
    if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
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

    const options = [...all].sort();
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
    if (state?.focusedNode) window.applyDepthFocus?.(state.focusedNode);
    buildRelationshipLegend();
    updateMetrics();
  }

  // keep edges hidden if either endpoint hidden (any reason)
  const syncEdges = (() => {
    const f = () => {
      cy.edges().forEach((e) => {
        const endpointsVisible = e.source().visible() && e.target().visible();
        if (endpointsVisible) e.removeClass(HIDE_ENDS);
        else e.addClass(HIDE_ENDS);
      });
    };
    let t;
    return () => { clearTimeout(t); t = setTimeout(f, 60); };
  })();

  // =========================================================
  // Layer-aware legend
  // =========================================================
  function clearLegend(container) {
    container.innerHTML = "";
  }

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

    const seen = new Set();
    cy.edges(":visible").forEach((e) => {
      const type = e.data("type");
      if (!type || seen.has(type)) return;
      seen.add(type);

      const color = e.style("line-color");
      const displayType = e.data("displayType") ?? type;

      container.appendChild(mkLegendItem({
        color,
        label: displayType,
        count: cy.edges(`:visible[type = "${type}"]`).length,
        active: relationshipFilter === type,
        onClick: () => window.filterByRelationshipType?.(type),
      }));
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
        onClick: () => {
          if (window.ONEXUS_LIFECYCLE?.setPhase) {
            window.ONEXUS_LIFECYCLE.setPhase(p);
            return;
          }
          const sel = document.getElementById("phaseFilter");
          if (sel) {
            [...sel.options].forEach(o => o.selected = (o.value === p));
            window.filterByPhase?.([p]);
          }
        }
      }));
    });
  }

  function buildLegendRisk(container) {
    clearLegend(container);

    const edges = baseEdgesForLegendAndMetrics();
    const runtime = window.ONEXUS_LAYER?.runtime ?? window.__onexus_layerRuntime ?? {};
    const cur = runtime.riskFilter ?? "all";

    const bucket = (v) => {
      if (v == null) return null;
      const s = String(v).trim().toLowerCase();
      if (!s) return null;
      if (s === "high" || s === "h" || s === "3") return "high";
      if (s === "medium" || s === "med" || s === "m" || s === "2") return "med";
      if (s === "low" || s === "l" || s === "1") return "low";
      const n = parseFloat(s);
      if (!Number.isFinite(n)) return null;
      if (n >= 0.75) return "high";
      if (n >= 0.4) return "med";
      return "low";
    };

    const counts = { high: 0, med: 0, low: 0, inferred: 0 };
    edges.forEach((e) => {
      const b = bucket(e.data("risk"));
      if (b) counts[b]++;
      const conf = String(e.data("confidence") ?? "").trim().toLowerCase();
      if (conf === "inferred") counts.inferred++;
    });

    const hint = document.createElement("div");
    hint.className = "legend-hint";
    hint.textContent = "Risk (click to filter)";
    container.appendChild(hint);

    container.appendChild(mkLegendItem({
      color: "#ef4444", label: "High", count: counts.high, active: (cur === "high"),
      onClick: () => window.ONEXUS_LAYER?.setRiskFilter?.(cur === "high" ? "all" : "high"),
    }));

    container.appendChild(mkLegendItem({
      color: "#64748b", label: "Inferred confidence", count: counts.inferred, active: (cur === "inferred"),
      onClick: () => window.ONEXUS_LAYER?.setRiskFilter?.(cur === "inferred" ? "all" : "inferred"),
    }));

    const clear = document.createElement("div");
    clear.className = "legend-item";
    clear.style.marginTop = "6px";
    clear.textContent = "Clear risk filter";
    clear.addEventListener("click", () => window.ONEXUS_LAYER?.setRiskFilter?.("all"));
    container.appendChild(clear);
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

    if (!optNodes.length) {
      const empty = document.createElement("div");
      empty.className = "legend-hint";
      empty.textContent = "No Option nodes found (import GD with “Materialize”).";
      container.appendChild(empty);
      return;
    }

    const sorted = optNodes.sort((a, b) => String(a.id()).localeCompare(String(b.id())));
    sorted.forEach((n) => {
      const label = n.data("displayLabel") ?? n.id();
      container.appendChild(mkLegendItem({
        color: "#6366f1",
        label,
        count: n.connectedEdges().length,
        active: n.selected(),
        onClick: () => {
          cy.nodes().unselect();
          n.select();
          cy.fit(n.closedNeighborhood(":visible"), 80);
          window.updateDetailsForNode?.(n);
          updateMetrics(); // option metrics refresh on selection
        }
      }));
    });
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
  // Layer-aware metrics blocks
  // =========================================================
  function metricsRow(k, v) {
    return `<div class="onx-metrics-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`;
  }

  function meterRow(label, value, total, color) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return `
      <div class="onx-metrics-row">
        <span class="k">${escapeHtml(label)}</span>
        <span class="v">${value}${total != null ? ` / ${total}` : ""}</span>
      </div>
      <div class="onx-meter"><span style="width:${pct}%;background:${color};"></span></div>
    `;
  }

  function riskBucket(v) {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v >= 0.75) return "high";
      if (v >= 0.4) return "med";
      return "low";
    }
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (s === "high" || s === "h" || s === "3") return "high";
    if (s === "medium" || s === "med" || s === "m" || s === "2") return "med";
    if (s === "low" || s === "l" || s === "1") return "low";
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    if (n >= 0.75) return "high";
    if (n >= 0.4) return "med";
    return "low";
  }

  function updateMetricsRelationship() {
    const tn = cy.nodes().length, vn = cy.nodes(":visible").length;
    const te = cy.edges().length, ve = cy.edges(":visible").length;
    const density = vn > 1 ? (ve / (vn * (vn - 1))).toFixed(3) : "0";

    const filters = [];
    if (dimensionFilter) filters.push(`dim=${dimensionFilter}`);
    if (relationshipFilter) filters.push(`type=${relationshipFilter}`);
    if (phaseFilterSet.size) filters.push(`phase=${[...phaseFilterSet].join("|")}`);
    const ftxt = filters.length ? filters.join(" · ") : "none";

    return `
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
    `;
  }

  function updateMetricsLifecycle() {
    const lc = window.ONEXUS_LIFECYCLE?.getState?.() ?? null;
    const edgesAll = baseEdgesForLegendAndMetrics();
    const edgesVisible = cy.edges(":visible");

    const phases = (lc?.phases && lc.phases.length) ? lc.phases : (window.__onexus_meta?.phases ?? []);
    const activePhase = lc?.phase ?? "(none)";
    const mode = lc?.mode ?? "exact";
    const hideIso = lc?.hideIsolated ? "on" : "off";
    const showUnphased = lc?.showUnphased ? "on" : "off";

    // tagged/unphased counts
    let tagged = 0, unphased = 0;
    edgesAll.forEach(e => {
      const ph = e.data("phase");
      const list = Array.isArray(ph) ? ph : (ph != null ? [ph] : []);
      if (list.length) tagged++; else unphased++;
    });

    // per-phase distribution (top 8)
    const phaseCounts = new Map();
    edgesAll.forEach(e => {
      const ph = e.data("phase");
      const list = Array.isArray(ph) ? ph : (ph != null ? [ph] : []);
      list.map(normStr).filter(Boolean).forEach(p => phaseCounts.set(p, (phaseCounts.get(p) ?? 0) + 1));
    });
    const rows = [...phaseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = rows.length ? rows[0][1] : 1;

    const distHtml = rows.map(([p, c]) =>
      meterRow(p, c, max, "#0ea5e9")
    ).join("");

    return `
      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Lifecycle</div>
        ${metricsRow("Active phase", `${activePhase}`)}
        ${metricsRow("Mode", `${mode}`)}
        ${metricsRow("Hide isolated", `${hideIso}`)}
        ${metricsRow("Show unphased", `${showUnphased}`)}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Visibility</div>
        ${metricsRow("Edges visible (now)", `${edgesVisible.length}`)}
        ${metricsRow("Edges tagged", `${tagged}`)}
        ${metricsRow("Edges unphased", `${unphased}`)}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Phase distribution (top)</div>
        ${distHtml || `<div class="onx-metrics-muted">No phase tags found.</div>`}
      </div>
    `;
  }

  function updateMetricsRisk() {
    const runtime = window.ONEXUS_LAYER?.runtime ?? window.__onexus_layerRuntime ?? {};
    const activeFilter = runtime.riskFilter ?? "all";

    const edgesAll = baseEdgesForLegendAndMetrics();
    const edgesVisible = cy.edges(":visible");

    const count = { high: 0, med: 0, low: 0, none: 0, inferred: 0, explicit: 0 };
    edgesAll.forEach(e => {
      const b = riskBucket(e.data("risk"));
      if (!b) count.none++; else count[b]++;
      const conf = String(e.data("confidence") ?? "").trim().toLowerCase();
      if (conf === "inferred") count.inferred++;
      else if (conf) count.explicit++;
    });

    const vCount = { high: 0, med: 0, low: 0, none: 0, inferred: 0 };
    edgesVisible.forEach(e => {
      const b = riskBucket(e.data("risk"));
      if (!b) vCount.none++; else vCount[b]++;
      const conf = String(e.data("confidence") ?? "").trim().toLowerCase();
      if (conf === "inferred") vCount.inferred++;
    });

    // nodes-by-risk class (computed in risk layer; if not present, fallback to "-")
    const nodesVisible = cy.nodes(":visible");
    const nBuckets = {
      high: nodesVisible.filter(n => n.hasClass("risk-high")).length,
      med: nodesVisible.filter(n => n.hasClass("risk-med")).length,
      low: nodesVisible.filter(n => n.hasClass("risk-low")).length,
    };
    const hasNodeClasses = (nBuckets.high + nBuckets.med + nBuckets.low) > 0;

    return `
      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Risk</div>
        ${metricsRow("Active filter", `${activeFilter}`)}
        ${metricsRow("Edges visible (now)", `${edgesVisible.length}`)}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Edges (all)</div>
        ${meterRow("High", count.high, edgesAll.length, "#ef4444")}
        ${meterRow("Medium", count.med, edgesAll.length, "#f59e0b")}
        ${meterRow("Low", count.low, edgesAll.length, "#10b981")}
        ${meterRow("No risk", count.none, edgesAll.length, "#94a3b8")}
        ${meterRow("Inferred (confidence)", count.inferred, edgesAll.length, "#64748b")}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Edges (visible)</div>
        ${meterRow("High", vCount.high, edgesVisible.length, "#ef4444")}
        ${meterRow("Inferred", vCount.inferred, edgesVisible.length, "#64748b")}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Nodes (visible)</div>
        ${hasNodeClasses
        ? (
          meterRow("High", nBuckets.high, nodesVisible.length, "#ef4444") +
          meterRow("Medium", nBuckets.med, nodesVisible.length, "#f59e0b") +
          meterRow("Low", nBuckets.low, nodesVisible.length, "#10b981")
        )
        : `<div class="onx-metrics-muted">Node risk classes not computed (enter Risk layer to compute).</div>`
      }
      </div>
    `;
  }

  function updateMetricsOption() {
    const runtime = window.ONEXUS_LAYER?.runtime ?? window.__onexus_layerRuntime ?? {};
    const activeFilter = runtime.optionFilter ?? "all";

    const optNodes = cy.nodes().filter(n =>
      String(n.data("nodeType") ?? "").toLowerCase() === "option" ||
      String(n.data("category") ?? "").toLowerCase() === "designoption"
    );

    const optEdges = cy.edges().filter(e => String(e.data("type") ?? "") === "Optimizes");
    const optEdgesVisible = cy.edges(":visible").filter(e => String(e.data("type") ?? "") === "Optimizes");

    // selected option node
    const selOpt = cy.nodes(":selected").filter(n =>
      String(n.data("nodeType") ?? "").toLowerCase() === "option" ||
      String(n.data("category") ?? "").toLowerCase() === "designoption"
    )[0] ?? (optNodes.length ? optNodes[0] : null);

    let metaHtml = `<div class="onx-metrics-muted">No option selected.</div>`;
    if (selOpt) {
      const d = selOpt.data() || {};
      const meta = d.gd?.meta ?? null;
      const scores = meta?.scores ?? null;
      const params = meta?.parameters ?? null;

      const lines = [];
      lines.push(metricsRow("Selected", d.displayLabel ?? d.id ?? selOpt.id()));
      if (meta?.problemId) lines.push(metricsRow("Problem", String(meta.problemId)));
      if (meta?.optionId) lines.push(metricsRow("OptionId", String(meta.optionId)));

      // compact score/param listing (top 6 each)
      const fmtKV = (obj, limit) => {
        if (!obj || typeof obj !== "object") return "";
        const keys = Object.keys(obj);
        if (!keys.length) return "";
        return keys.slice(0, limit).map(k => `${k}=${obj[k]}`).join(", ");
      };

      const sTxt = fmtKV(scores, 6);
      const pTxt = fmtKV(params, 6);
      if (sTxt) lines.push(metricsRow("Scores", sTxt));
      if (pTxt) lines.push(metricsRow("Params", pTxt));

      metaHtml = `<div class="onx-metrics-kv">${lines.join("")}</div>`;
    }

    return `
      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Option</div>
        ${metricsRow("Active filter", `${activeFilter}`)}
        ${metricsRow("Option nodes", `${optNodes.length}`)}
        ${metricsRow("Optimizes edges (visible/total)", `${optEdgesVisible.length} / ${optEdges.length}`)}
      </div>

      <div class="onx-metrics-sec">
        <div class="onx-metrics-title">Selection</div>
        ${metaHtml}
      </div>
    `;
  }

  function updateMetrics() {
    const box = document.getElementById("metrics");
    if (!box) return;

    const layer = getLayer();
    let html = "";

    if (layer === "lifecycle") html = updateMetricsLifecycle();
    else if (layer === "risk") html = updateMetricsRisk();
    else if (layer === "option") html = updateMetricsOption();
    else html = updateMetricsRelationship();

    box.innerHTML = `<div class="onx-metrics-wrap">${html}</div>`;
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
})();