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

  function refreshNode(n) {
    window.buildCategoryFilter?.();
    window.updateMetrics?.();
    if (n && n.nonempty?.()) window.updateDetailsForNode?.(n);
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
    },

    addNode(data, position /* {x,y} optional */) {
      const snapshot = (typeof structuredClone === 'function') ? structuredClone(data) : JSON.parse(JSON.stringify(data));
      const pos = position ? { x: position.x, y: position.y } : null;
      return {
        name: 'addNode',
        data: snapshot,
        position: pos,
        apply() {
          const payload = this.position ? { data: this.data, position: this.position } : { data: this.data };
          const n = cy.add(payload);
          const lang = window.__onexus_state?.language ?? 'en';
          const lbl = n.data('label');
          n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
          window.buildCategoryFilter?.();  // refresh filters & metrics like edges do
          window.updateMetrics?.();
          if (n && n.nonempty?.()) window.updateDetailsForNode?.(n);
        },
        revert() {
          const n = cy.getElementById(this.data.id);
          if (n && n.nonempty?.()) cy.remove(n);
          window.buildCategoryFilter?.();
          window.updateMetrics?.();
        }
      };
    },
    removeNode(nodeId, nodeData, incidentEdges /* optional: data[] */) {
      const savedN = (typeof structuredClone === 'function') ? structuredClone(nodeData) : JSON.parse(JSON.stringify(nodeData));
      const savedE = (typeof structuredClone === 'function') ? structuredClone(incidentEdges ?? []) : JSON.parse(JSON.stringify(incidentEdges ?? []));
      return {
        name: 'removeNode',
        id: nodeId,
        node: savedN,
        edges: savedE,
        apply() {
          const n = cy.getElementById(this.id);
          if (n && n.nonempty?.()) {
            // removing node also removes its incident edges in cy
            cy.remove(n);
          }
          refreshNode();
        },
        revert() {
          const n = cy.add({ data: this.node });
          // restore edges (only if endpoints exist)
          this.edges.forEach(e => {
            if (cy.getElementById(e.id).nonempty?.()) return;
            const sOk = cy.getElementById(e.source).nonempty?.();
            const tOk = cy.getElementById(e.target).nonempty?.();
            if (sOk && tOk) {
              const added = cy.add({ data: e });
              // mirror edge label/i18n like other actions
              const map = (window.__onexus_labels?.[window.__onexus_state?.language] ?? {});
              added.data('displayType', map[added.data('type')] ?? added.data('type'));
              added.style('text-opacity', window.__onexus_state?.showEdgeLabels ? 1 : 0);
            }
          });
          // i18n display label
          const lang = window.__onexus_state?.language ?? 'en';
          const lbl = n.data('label');
          n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
          refreshNode(n);
        }
      };
    },
    editNode(nodeId, beforeData, afterPatch) {
      const before = (typeof structuredClone === 'function') ? structuredClone(beforeData) : JSON.parse(JSON.stringify(beforeData));
      const after = { ...before, ...afterPatch, id: nodeId };
      return {
        name: 'editNode',
        id: nodeId,
        before, after,
        apply() {
          const n = cy.getElementById(this.id);
          if (!n || !n.nonempty?.()) return;
          n.data(this.after);
          // keep display label in sync with i18n
          const lang = window.__onexus_state?.language ?? 'en';
          const lbl = n.data('label');
          n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
          refreshNode(n);
        },
        revert() {
          const n = cy.getElementById(this.id);
          if (!n || !n.nonempty?.()) return;
          n.data(this.before);
          const lang = window.__onexus_state?.language ?? 'en';
          const lbl = n.data('label');
          n.data('displayLabel', (lbl && (lbl[lang] ?? lbl['en'])) ?? n.data('id'));
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