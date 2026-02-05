/* ONEXUS – Scenario Compare (A/B) */
(function () {
  const cy = window.cy;
  const LABELS = window.__onexus_labels;
  const state = window.__onexus_state;

  // ---------------- UI: chip ----------------
  function ensureCompareChip() {
    let chip = document.getElementById('onexus-compare-chip');
    if (chip) return chip;
    const toolbar = document.getElementById('toolbar'); if (!toolbar) return null;

    chip = document.createElement('div');
    chip.id = 'onexus-compare-chip';
    Object.assign(chip.style, {
      display: 'none', marginLeft: '8px', padding: '4px 8px',
      border: '1px solid var(--stroke)', borderRadius: '999px',
      background: 'var(--bg-soft)', color: 'var(--text-main)',
      fontSize: '12px', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap'
    });

    const label = document.createElement('span'); label.id = 'onexus-compare-chip-text';
    const btnMerged = mkBtn('Merged', () => setMode('merged'));
    const btnOnlyDiff = mkBtn('Only Diff', () => setMode('only_diff'));
    const btnOnlyA = mkBtn('Only A', () => setMode('only_a'));
    const btnOnlyB = mkBtn('Only B', () => setMode('only_b'));
    const btnExit = mkBtn('Exit', () => exitCompare());

    chip.append(label, btnMerged, btnOnlyDiff, btnOnlyA, btnOnlyB, btnExit);
    toolbar.appendChild(chip);
    return chip;
  }
  function mkBtn(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      padding: '2px 8px', borderRadius: '10px',
      border: '1px solid var(--stroke)', background: 'var(--btn-bg)',
      cursor: 'pointer', fontSize: '12px'
    });
    b.addEventListener('click', onClick);
    return b;
  }
  function showChip(stats) {
    const chip = ensureCompareChip(); if (!chip) return;
    chip.style.display = 'flex';
    const t = document.getElementById('onexus-compare-chip-text');
    t.textContent = `Compare A/B — Nodes: +${stats.nodes.added} –${stats.nodes.removed} ~${stats.nodes.changed} | Edges: +${stats.edges.added} –${stats.edges.removed} ~${stats.edges.changed}`;
  }
  function hideChip() {
    const chip = document.getElementById('onexus-compare-chip');
    if (chip) chip.style.display = 'none';
  }

  // ---------------- internal ----------------
  const last = { A: null, B: null, mode: 'merged' };

  function stableStringify(x) {
    if (x == null) return 'null';
    if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
    if (typeof x === 'object') {
      const keys = Object.keys(x).sort();
      return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(',')}}`;
    }
    return JSON.stringify(x);
  }
  const eq = (a, b) => stableStringify(a) === stableStringify(b);

  function nodeKey(n) { return n?.data?.id; }
  function edgeKey(e) {
    const d = e?.data || {};
    return `${d.type}|${d.dimension}|${d.source}|${d.target}|${d.directional ? 1 : 0}`;
  }

  function diffGraphs(A, B) {
    const aNodes = new Map((A.elements?.nodes ?? []).map(n => [nodeKey(n), n]));
    const bNodes = new Map((B.elements?.nodes ?? []).map(n => [nodeKey(n), n]));
    const aEdges = new Map((A.elements?.edges ?? []).map(e => [edgeKey(e), e]));
    const bEdges = new Map((B.elements?.edges ?? []).map(e => [edgeKey(e), e]));

    const nodes = [];
    const edges = [];

    const stats = { nodes: { added: 0, removed: 0, changed: 0 }, edges: { added: 0, removed: 0, changed: 0 } };

    // Nodes
    const nodeIds = new Set([...aNodes.keys(), ...bNodes.keys()]);
    nodeIds.forEach(id => {
      const an = aNodes.get(id), bn = bNodes.get(id);
      if (an && !bn) {
        const d = { ...an.data, __inA: true, __inB: false, __diff: 'removed' };
        nodes.push({ data: d, classes: 'diff-removed' }); stats.nodes.removed++;
      } else if (!an && bn) {
        const d = { ...bn.data, __inA: false, __inB: true, __diff: 'added' };
        nodes.push({ data: d, classes: 'diff-added' }); stats.nodes.added++;
      } else if (an && bn) {
        const fields = ['label', 'category', 'revitCategory', 'nodeType', 'level'];
        const changed = fields.filter(f => !eq(an.data?.[f], bn.data?.[f]));
        const base = { ...bn.data, __inA: true, __inB: true, __diff: changed.length ? 'changed' : 'same' };
        if (changed.length) { base.__changes = changed; stats.nodes.changed++; }
        nodes.push({ data: base, classes: changed.length ? 'diff-changed' : '' });
      }
    });

    // Edges
    const eKeys = new Set([...aEdges.keys(), ...bEdges.keys()]);
    eKeys.forEach(k => {
      const ae = aEdges.get(k), be = bEdges.get(k);
      if (ae && !be) {
        const d = { ...ae.data, __inA: true, __inB: false, __diff: 'removed' };
        d.id = d.id || `A-${k}`; // ensure id
        edges.push({ data: d, classes: 'diff-removed' }); stats.edges.removed++;
      } else if (!ae && be) {
        const d = { ...be.data, __inA: false, __inB: true, __diff: 'added' };
        d.id = d.id || `B-${k}`;
        edges.push({ data: d, classes: 'diff-added' }); stats.edges.added++;
      } else if (ae && be) {
        const fields = ['phase', 'owner', 'risk', 'confidence', 'notes'];
        const changed = fields.filter(f => !eq(ae.data?.[f], be.data?.[f]));
        const base = { ...(be.data || {}), __inA: true, __inB: true, __diff: changed.length ? 'changed' : 'same' };
        if (changed.length) { base.__changes = changed; stats.edges.changed++; }
        base.id = base.id || `AB-${k}`;
        edges.push({ data: base, classes: changed.length ? 'diff-changed' : '' });
      }
    });

    return { elements: { nodes, edges }, stats };
  }

  // ---------------- public API ----------------
  function compareAB(graphA, graphB) {
    last.A = graphA; last.B = graphB; last.mode = 'merged';

    const { elements, stats } = diffGraphs(graphA, graphB);

    // Load the merged compare graph using the public loader
    if (typeof window.onexusLoadGraph === 'function') {
      window.onexusLoadGraph({ elements });
    } else {
      cy.elements().remove(); cy.add(elements.nodes); cy.add(elements.edges);
    }

    // Language mapping for edge display labels
    window.setLanguage?.(state?.language ?? 'en');

    // Build filters/legend/metrics on new content
    window.buildCategoryFilter?.();
    window.buildPhaseFilter?.();
    window.buildRelationshipLegend?.();
    window.updateMetrics?.();

    showChip(stats);
    setMode('merged'); // default view
    window.showTransientMessage?.('Compare A/B loaded');
  }

  function compareFromFilePair(fileA, fileB) {
    Promise.all([fileA.text(), fileB.text()])
      .then(([ta, tb]) => {
        const A = JSON.parse(ta), B = JSON.parse(tb);
        compareAB(A, B);
      })
      .catch(err => alert('Failed to load A/B: ' + err.message));
  }

  // Modes: merged | only_diff | only_a | only_b
  function setMode(mode) {
    last.mode = mode;
    const show = (ele) => ele.style('display', 'element');
    const hide = (ele) => ele.style('display', 'none');

    // Nodes
    cy.nodes().forEach(n => {
      const d = n.data();
      const diff = d.__diff, inA = !!d.__inA, inB = !!d.__inB;
      let vis = true;
      switch (mode) {
        case 'only_diff': vis = (diff === 'added' || diff === 'removed' || diff === 'changed'); break;
        case 'only_a': vis = inA; break;
        case 'only_b': vis = inB; break;
        default: vis = true;
      }
      (vis ? show : hide)(n);
    });

    // Edges
    cy.edges().forEach(e => {
      const d = e.data();
      const diff = d.__diff, inA = !!d.__inA, inB = !!d.__inB;
      let vis = true;
      switch (mode) {
        case 'only_diff': vis = (diff === 'added' || diff === 'removed' || diff === 'changed'); break;
        case 'only_a': vis = inA; break;
        case 'only_b': vis = inB; break;
        default: vis = true;
      }
      (vis ? show : hide)(e);
    });

    // Keep edges synced with hidden endpoints (reuse your sync in filters if present)
    if (typeof window.buildRelationshipLegend === 'function') window.buildRelationshipLegend();
    window.updateMetrics?.();
    cy.fit(cy.elements(':visible'), 60);
  }

  function exitCompare() {
    hideChip();
    if (last.B) {
      // Load B as the final scenario (common pattern)
      window.onexusLoadGraph?.(last.B);
      window.showTransientMessage?.('Exited compare (showing B)');
    } else {
      // Fallback: clear
      cy.elements().remove();
    }
  }

  // Expose
  window.ONEXUS_COMPARE = { compareAB, compareFromFilePair, setMode, exitCompare };
})();