/* ONEXUS – Undo/Redo (command stack for graph mutations)
   PATCH (Option A follow-up): prefer ONEXUS.util helpers (clone/exists) with safe fallbacks.
   Behavior unchanged; exports unchanged: window.ONEXUS_UNDO.
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;
  const LABELS = window.__onexus_labels;

  // Prefer ONEXUS namespace helpers if present (Option A follow-up)
  const U = window.ONEXUS?.util || {};
  const clone = U.clone || function (x) {
    return (typeof structuredClone === "function")
      ? structuredClone(x)
      : JSON.parse(JSON.stringify(x));
  };
  const exists = U.exists || function (col) {
    return !!col && !!col.nonempty && col.nonempty();
  };

  const stack = { undo: [], redo: [], limit: 200 };

  function refresh(edge) {
    window.buildRelationshipLegend?.();
    window.updateMetrics?.();
    if (edge && edge.nonempty?.()) window.updateDetailsForEdge?.(edge);
  }

  function setEdgeDisplayType(e) {
    const t = e.data("type");
    const map = (LABELS?.[state?.language] ?? {});
    e.data("displayType", map[t] ?? t);
    e.style("text-opacity", state?.showEdgeLabels ? 1 : 0);
  }

  function refreshNode(n) {
    window.buildCategoryFilter?.();
    window.updateMetrics?.();
    if (n && n.nonempty?.()) window.updateDetailsForNode?.(n);
  }

  const actions = {
    addEdge(data) {
      const snapshot = clone(data);
      return {
        name: "addEdge",
        data: snapshot,
        apply() {
          const e = cy.add({ data: this.data });
          setEdgeDisplayType(e);
          refresh(e);
        },
        revert() {
          const e = cy.getElementById(this.data.id);
          if (exists(e)) cy.remove(e);
          refresh();
        }
      };
    },

    removeEdge(edgeId, edgeData) {
      const saved = clone(edgeData);
      return {
        name: "removeEdge",
        id: edgeId,
        data: saved,
        apply() {
          const e = cy.getElementById(this.id);
          if (exists(e)) cy.remove(e);
          refresh();
        },
        revert() {
          const e = cy.add({ data: this.data });
          setEdgeDisplayType(e);
          refresh(e);
        }
      };
    },

    editEdge(edgeId, beforeData, afterPatch) {
      const before = clone(beforeData);
      const after = { ...before, ...afterPatch, id: edgeId };
      return {
        name: "editEdge",
        id: edgeId,
        before,
        after,
        apply() {
          const e = cy.getElementById(this.id);
          if (!exists(e)) return;
          e.data(this.after);
          setEdgeDisplayType(e);
          refresh(e);
        },
        revert() {
          const e = cy.getElementById(this.id);
          if (!exists(e)) return;
          e.data(this.before);
          setEdgeDisplayType(e);
          refresh(e);
        }
      };
    },

    reverseEdge(edgeId) {
      return {
        name: 'reverseEdge',
        id: edgeId,
        apply() {
          const e = cy.getElementById(this.id);
          if (!e || !e.nonempty?.() || !e.nonempty()) return;

          const d = { ...e.data() };
          const newSource = d.target;
          const newTarget = d.source;

          // 1) Rewire endpoints (this is what makes the arrow flip visually)
          e.move({ source: newSource, target: newTarget });

          // 2) Keep data in sync (optional but good hygiene)
          d.source = newSource;
          d.target = newTarget;
          e.data(d);

          setEdgeDisplayType(e);
          refresh(e);
        },
        revert() {
          const e = cy.getElementById(this.id);
          if (!e || !e.nonempty?.() || !e.nonempty()) return;

          const d = { ...e.data() };
          const newSource = d.target;
          const newTarget = d.source;

          e.move({ source: newSource, target: newTarget });

          d.source = newSource;
          d.target = newTarget;
          e.data(d);

          setEdgeDisplayType(e);
          refresh(e);
        }
      };
    },
    addNode(data, position /* {x,y} optional */) {
      const snapshot = clone(data);
      const pos = position ? { x: position.x, y: position.y } : null;
      return {
        name: "addNode",
        data: snapshot,
        position: pos,
        apply() {
          const payload = this.position ? { data: this.data, position: this.position } : { data: this.data };
          const n = cy.add(payload);
          const lang = window.__onexus_state?.language ?? "en";
          const lbl = n.data("label");
          n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));
          window.buildCategoryFilter?.();
          window.updateMetrics?.();
          if (exists(n)) window.updateDetailsForNode?.(n);
        },
        revert() {
          const n = cy.getElementById(this.data.id);
          if (exists(n)) cy.remove(n);
          window.buildCategoryFilter?.();
          window.updateMetrics?.();
        }
      };
    },

    removeNode(nodeId, nodeData, incidentEdges /* optional: data[] */) {
      const savedN = clone(nodeData);
      const savedE = clone(incidentEdges ?? []);
      return {
        name: "removeNode",
        id: nodeId,
        node: savedN,
        edges: savedE,
        apply() {
          const n = cy.getElementById(this.id);
          if (exists(n)) {
            // removing node also removes its incident edges in cy
            cy.remove(n);
          }
          refreshNode();
        },
        revert() {
          const n = cy.add({ data: this.node });

          // restore edges (only if endpoints exist)
          this.edges.forEach(ed => {
            if (exists(cy.getElementById(ed.id))) return;
            const sOk = exists(cy.getElementById(ed.source));
            const tOk = exists(cy.getElementById(ed.target));
            if (sOk && tOk) {
              const added = cy.add({ data: ed });
              // mirror edge label/i18n like other actions do
              const map = (window.__onexus_labels?.[window.__onexus_state?.language] ?? {});
              added.data("displayType", map[added.data("type")] ?? added.data("type"));
              added.style("text-opacity", window.__onexus_state?.showEdgeLabels ? 1 : 0);
            }
          });

          // i18n display label
          const lang = window.__onexus_state?.language ?? "en";
          const lbl = n.data("label");
          n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));

          refreshNode(n);
        }
      };
    },

    editNode(nodeId, beforeData, afterPatch) {
      const before = clone(beforeData);
      const after = { ...before, ...afterPatch, id: nodeId };
      return {
        name: "editNode",
        id: nodeId,
        before,
        after,
        apply() {
          const n = cy.getElementById(this.id);
          if (!exists(n)) return;
          n.data(this.after);

          // keep display label in sync with i18n
          const lang = window.__onexus_state?.language ?? "en";
          const lbl = n.data("label");
          n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));

          refreshNode(n);
        },
        revert() {
          const n = cy.getElementById(this.id);
          if (!exists(n)) return;
          n.data(this.before);

          const lang = window.__onexus_state?.language ?? "en";
          const lbl = n.data("label");
          n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));

          refreshNode(n);
        }
      };
    },
  };

  function apply(cmd) { cmd.apply?.(); }
  function revert(cmd) { cmd.revert?.(); }

  function doCmd(cmd) {
    if (!cmd) return;
    apply(cmd);
    stack.undo.push(cmd);
    stack.redo.length = 0;
    if (stack.undo.length > stack.limit) stack.undo.shift();
  }

  function undo() {
    const cmd = stack.undo.pop();
    if (!cmd) { window.showTransientMessage?.("Nothing to undo"); return; }
    revert(cmd);
    stack.redo.push(cmd);
  }

  function redo() {
    const cmd = stack.redo.pop();
    if (!cmd) { window.showTransientMessage?.("Nothing to redo"); return; }
    apply(cmd);
    stack.undo.push(cmd);
  }

  window.ONEXUS_UNDO = {
    do: doCmd,
    undo,
    redo,
    clear: () => { stack.undo.length = 0; stack.redo.length = 0; },
    canUndo: () => stack.undo.length > 0,
    canRedo: () => stack.redo.length > 0,
    actions
  };
})();