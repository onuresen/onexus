/* ONEXUS – Generative Design Importer (overlay / materialize-edges)
 SET C PATCH:
 - Standardize import session stamping using ONEXUS.import.applyMeta()/stampSession()
*/
(function () {
  const clone = (x) =>
    (typeof structuredClone === "function") ? structuredClone(x) : JSON.parse(JSON.stringify(x));
  const exists = (col) => !!col && !!col.nonempty && col.nonempty();
  const nowIso = () => new Date().toISOString();

  function getCy() {
    const cy = window.cy;
    if (!cy || typeof cy.nodes !== "function") throw new Error("Cytoscape (window.cy) is not ready.");
    return cy;
  }

  function stampImportSession({ importer, sourceFiles, mode }) {
    try {
      const applyMeta = window.ONEXUS?.import?.applyMeta;
      const stampSession = window.ONEXUS?.import?.stampSession;

      // meta-only graph object
      let g = { meta: {} };
      if (typeof applyMeta === "function") {
        g = applyMeta(g, {
          importer,
          sourceFiles,
          sourceKind: "mutation",
          mode: mode ?? "",
          importedAt: nowIso(),
        });
      } else if (typeof stampSession === "function") {
        stampSession({
          importer,
          sourceFiles,
          sourceKind: "mutation",
          mode: mode ?? "",
          importedAt: nowIso(),
        });
      }
    } catch { }
  }

  function chooseOption(payload, optionId) {
    const opts = Array.isArray(payload?.options) ? payload.options : [];
    if (!opts.length) throw new Error("GD payload has no options[]");
    if (optionId) {
      const found = opts.find(o => String(o.id) === String(optionId));
      if (!found) throw new Error(`Option '${optionId}' not found`);
      return found;
    }
    const byRank1 = opts.find(o => o.rank === 1);
    if (byRank1) return byRank1;
    const pareto = opts.find(o => o.pareto === true);
    return pareto ?? opts[0];
  }

  function normalizePayload(payload) {
    if (!payload) throw new Error("GD payload is empty.");
    if (payload.type && payload.type !== "onexus/generative-design") {
      if (!payload?.options) throw new Error("Not a GD payload (missing options[]).");
    }
    return payload;
  }

  function ensureNode(id, seed = {}) {
    const cy = getCy();
    let n = cy.getElementById(id);
    if (!exists(n)) {
      n = cy.add({
        data: {
          id,
          nodeType: seed.nodeType ?? "Component",
          category: seed.category ?? "Uncategorized",
          label: seed.label ?? { en: id, jp: id },
          displayLabel: seed.displayLabel ?? id,
        },
      });
    }
    return n;
  }

  function ensureEdgeId(base) {
    const cy = getCy();
    let i = 1;
    let id = base;
    while (exists(cy.getElementById(id))) id = `${base}-${++i}`;
    return id;
  }

  function updateUiAfterMutation() {
    const lang = window.__onexus_state?.language ?? "en";
    window.setLanguage?.(lang);
    window.buildCategoryFilter?.();
    window.buildPhaseFilter?.();
    window.buildRelationshipLegend?.();
    window.updateMetrics?.();
  }

  function overlayOptionOnGraph(payload, option) {
    const cy = getCy();
    const probId = payload?.problem?.id ?? "GD";
    const optId = option.id;
    const mark = { problemId: probId, optionId: optId, when: nowIso(), type: "overlay" };

    const nodes = option?.affected?.nodes ?? [];
    nodes.forEach(n => {
      const node = ensureNode(n.id);
      const d = clone(node.data());
      d.gd = d.gd ?? {};
      d.gd[optId] = {
        scores: clone(option.scores ?? {}),
        parameters: clone(option.parameters ?? {}),
        metrics: clone(n.metrics ?? {}),
        constraintsEval: clone(option.constraintsEval ?? {}),
        mark,
      };
      node.data(d);
    });

    const eitems = option?.affected?.edges ?? [];
    eitems.forEach(e => {
      let hit = null;
      if (e.id) {
        const col = cy.getElementById(e.id);
        if (exists(col)) hit = col;
      }
      if (!hit) {
        const fwd = cy.edges().filter(x => x.data("source") === e.source && x.data("target") === e.target);
        if (fwd.length) hit = fwd[0];
      }
      if (!hit) return;

      const d = clone(hit.data());
      d.gd = d.gd ?? {};
      d.gd[optId] = {
        scores: clone(option.scores ?? {}),
        parameters: clone(option.parameters ?? {}),
        metrics: clone(e.metrics ?? {}),
        constraintsEval: clone(option.constraintsEval ?? {}),
        mark,
      };
      hit.data(d);
    });

    updateUiAfterMutation();
    window.showTransientMessage?.(`GD overlay applied: ${probId} / ${optId}`);
  }

  function materializeOptionToGraph(payload, option) {
    const cy = getCy();
    const prob = payload?.problem?.id ?? "GD";
    const opt = String(option.id);
    const optNodeId = `GDOPT_${prob}_${opt}`;

    const optNode = ensureNode(optNodeId, {
      nodeType: "Option",
      category: "DesignOption",
      label: { en: `Option ${opt}`, jp: `Option ${opt}` },
      displayLabel: `Option ${opt}`,
    });

    const d0 = clone(optNode.data());
    d0.gd = d0.gd ?? {};
    d0.gd.meta = {
      problemId: prob,
      optionId: opt,
      scores: clone(option.scores ?? {}),
      parameters: clone(option.parameters ?? {}),
      createdAt: option.createdAt ?? nowIso(),
    };
    optNode.data(d0);

    const nodes = option?.affected?.nodes ?? [];
    nodes.forEach(n => {
      const target = ensureNode(n.id);
      const eid = ensureEdgeId(`e_${optNodeId}_Optimizes_${target.id()}`);
      cy.add({
        data: {
          id: eid,
          type: "Optimizes",
          dimension: "System",
          directional: true,
          source: optNodeId,
          target: target.id(),
          notes: `metrics=${JSON.stringify(n.metrics ?? {})}`,
        },
      });
    });

    const eitems = option?.affected?.edges ?? [];
    eitems.forEach(e => {
      ensureNode(e.source);
      ensureNode(e.target);
      const base = `e_${e.source}_${e.type ?? "RelatedTo"}_${e.target}`;
      const id = ensureEdgeId(base);
      cy.add({
        data: {
          id,
          type: e.type ?? "RelatedTo",
          dimension: e.dimension ?? "System",
          directional: !!e.directional,
          source: e.source,
          target: e.target,
          notes: e.metrics ? `metrics=${JSON.stringify(e.metrics)}` : "",
        },
      });
    });

    updateUiAfterMutation();
    window.showTransientMessage?.(`GD materialized: ${prob} / ${opt}`);
  }

  async function importFromFile(event, { mode = "overlay", optionId = null } = {}) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text);
    return importFromPayload(payload, { mode, optionId, sourceFiles: [file.name] });
  }

  function importFromPayload(payload, { mode = "overlay", optionId = null, sourceFiles = ["(in-memory)"] } = {}) {
    const P = normalizePayload(payload);
    const opt = chooseOption(P, optionId);

    // ✅ Set C: stamp mutation session
    stampImportSession({ importer: "gd", sourceFiles, mode });

    if (mode === "materialize-edges") materializeOptionToGraph(P, opt);
    else overlayOptionOnGraph(P, opt);
  }

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener("message", (e) => {
      const msg = e?.data;
      if (!msg || !msg.type) return;
      if (msg.type === "onexus-gd-import") {
        try {
          importFromPayload(msg.payload, {
            mode: msg.mode ?? "overlay",
            optionId: msg.optionId ?? null,
            sourceFiles: ["(webview)"],
          });
        } catch (err) {
          alert("GD import failed: " + err.message);
        }
      }
    });
  }

  window.IMPORT_GD = { importFromFile, importFromPayload, overlayOptionOnGraph, materializeOptionToGraph };
})();

// Plugin registration: GD
(function () {
  const ONX = window.ONEXUS;
  if (!ONX || typeof ONX.registerPlugin !== "function") return;

  ONX.registerPlugin({
    id: "gd",
    title: "Generative Design Importer",
    register(api) {
      api.registerImporter({
        id: "gd",
        label: "GD JSON (overlay / materialize)",
        priority: 80,
        extensions: ["json"],
        acceptMultiple: false,
        canHandleText: async (text) => {
          const t = String(text ?? "");
          return t.includes('"options"') && (t.includes('"problem"') || t.includes('"onexus/generative-design"'));
        },
        importText: async (text, file, ctx) => {
          const payload = JSON.parse(text);
          const mode = ctx?.opts?.mode ?? "overlay";
          const optionId = ctx?.opts?.optionId ?? null;
          const sourceFiles = [file?.name ?? "(file)"];
          if (window.IMPORT_GD?.importFromPayload) {
            window.IMPORT_GD.importFromPayload(payload, { mode, optionId, sourceFiles });
            return;
          }
          throw new Error("IMPORT_GD.importFromPayload is not available");
        },
      });

      api.registerEdgeTypeLabels("Optimizes", { en: "Optimizes", jp: "最適化" });
    },
  });
})();