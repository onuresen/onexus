/* ONEXUS – Undo/Redo (command stack for graph mutations) */
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;
  const LABELS = window.__onexus_labels;

  const stack = { undo: [], redo: [], limit: 200 };

  function refresh(edge) {
    window.buildRelationshipLegend?.();
    window.updateMetrics?.();
    if (edge && edge.nonempty?.()) window.updateDetailsForEdge?.(edge);
  }
  function setEdgeDisplayType(e) {
    const t = e.data('type');
    const map = (LABELS?.[state?.language] ?? {});
    e.data('displayType', map[t] ?? t);
    e.style('text-opacity', state?.showEdgeLabels ? 1 : 0);
  }

  const actions = {
    addEdge(data) {
      const snapshot = (typeof structuredClone === 'function') ? structuredClone(data) : JSON.parse(JSON.stringify(data));
      return {
        name: 'addEdge',
        data: snapshot,
        apply() {
          const e = cy.add({ data: this.data });
          setEdgeDisplayType(e);
          refresh(e);
        },
        revert() {
          const e = cy.getElementById(this.data.id);
          if (e && e.nonempty?.()) cy.remove(e);
          refresh();
        }
      };
    },
    removeEdge(edgeId, edgeData) {
      const saved = (typeof structuredClone === 'function') ? structuredClone(edgeData) : JSON.parse(JSON.stringify(edgeData));
      return {
        name: 'removeEdge',
        id: edgeId,
        data: saved,
        apply() {
          const e = cy.getElementById(this.id);
          if (e && e.nonempty?.()) cy.remove(e);
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
      const before = (typeof structuredClone === 'function') ? structuredClone(beforeData) : JSON.parse(JSON.stringify(beforeData));
      const after = { ...before, ...afterPatch, id: edgeId };
      return {
        name: 'editEdge',
        id: edgeId,
        before, after,
        apply() {
          const e = cy.getElementById(this.id);
          if (!e || !e.nonempty?.()) return;
          e.data(this.after);
          setEdgeDisplayType(e);
          refresh(e);
        },
        revert() {
          const e = cy.getElementById(this.id);
          if (!e || !e.nonempty?.()) return;
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
          const e = cy.getElementById(this.id); if (!e || !e.nonempty?.()) return;
          const d = { ...e.data() }; const tmp = d.source; d.source = d.target; d.target = tmp;
          e.data(d); setEdgeDisplayType(e); refresh(e);
        },
        revert() { // swap back
          const e = cy.getElementById(this.id); if (!e || !e.nonempty?.()) return;
          const d = { ...e.data() }; const tmp = d.source; d.source = d.target; d.target = tmp;
          e.data(d); setEdgeDisplayType(e); refresh(e);
        }
      };
    }
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
    if (!cmd) { window.showTransientMessage?.('Nothing to undo'); return; }
    revert(cmd);
    stack.redo.push(cmd);
  }
  function redo() {
    const cmd = stack.redo.pop();
    if (!cmd) { window.showTransientMessage?.('Nothing to redo'); return; }
    apply(cmd);
    stack.undo.push(cmd);
  }

  window.ONEXUS_UNDO = {
    do: doCmd, undo, redo, clear: () => { stack.undo.length = 0; stack.redo.length = 0; },
    canUndo: () => stack.undo.length > 0,
    canRedo: () => stack.redo.length > 0,
    actions
  };
})();