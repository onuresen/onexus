/* ONEXUS – Pathfinder & Up/Downstream (context actions) */
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;

  // --- path selection UI (chip near toolbar) ---
  function ensurePathChip() {
    let chip = document.getElementById('onexus-path-chip');
    if (chip) return chip;
    const toolbar = document.getElementById('toolbar'); if (!toolbar) return null;
    chip = document.createElement('div'); chip.id = 'onexus-path-chip';
    Object.assign(chip.style, {
      display: 'none', marginLeft: '8px', padding: '4px 8px',
      border: '1px solid var(--stroke)', borderRadius: '999px',
      background: 'var(--bg-soft)', color: 'var(--text-main)',
      fontSize: '12px', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', userSelect: 'none'
    });
    const text = document.createElement('span'); text.id = 'onexus-path-chip-text';
    const btn = document.createElement('button'); btn.textContent = 'Cancel';
    Object.assign(btn.style, {
      marginLeft: '8px', padding: '2px 8px', borderRadius: '10px',
      border: '1px solid var(--stroke)', background: 'var(--btn-bg)', cursor: 'pointer', fontSize: '12px'
    });
    btn.addEventListener('click', () => cancel());
    chip.appendChild(text); chip.appendChild(btn); toolbar.appendChild(chip);
    return chip;
  }
  function updatePathChip() {
    const chip = ensurePathChip(); if (!chip) return;
    const text = document.getElementById('onexus-path-chip-text');
    if (pathState.src) { chip.style.display = 'flex'; text.textContent = `Path from: ${labelOf(pathState.src)}`; }
    else chip.style.display = 'none';
  }

  // --- internal state ---
  const pathState = { src: null, lastHighlight: cy.collection() };

  function labelOf(n) { return n?.data('displayLabel') ?? n?.id?.() ?? ''; }

  function clearHighlight() {
    try {
      pathState.lastHighlight.removeClass('path');
      pathState.lastHighlight.removeClass('upstream');
      pathState.lastHighlight.removeClass('downstream');
      cy.nodes().removeClass('highlight'); // optional: also remove search highlight
    } catch { }
    pathState.lastHighlight = cy.collection();
  }

  function highlight(col, mode /* 'path'|'upstream'|'downstream' */) {
    clearHighlight();
    if (!col || !col.nonempty || !col.nonempty()) return;
    if (mode === 'upstream') col.addClass('path').addClass('upstream');
    else if (mode === 'downstream') col.addClass('path').addClass('downstream');
    else col.addClass('path');
    pathState.lastHighlight = col;
    cy.fit(col, 60);
  }

  function beginFrom(node) {
    cancel();
    pathState.src = node; node.addClass('highlight');
    updatePathChip();
    window.showTransientMessage?.('Pick a target node to compute shortest path…');
  }

  function cancel() {
    if (pathState.src) pathState.src.removeClass('highlight');
    pathState.src = null;
    updatePathChip();
  }

  // --- graph helpers (visible world only) ---
  function visibleNodeIdsSet() {
    const s = new Set();
    cy.nodes(':visible').forEach(n => s.add(n.id()));
    return s;
  }
  function visibleEdges() { return cy.edges(':visible'); }

  // Get one visible edge connecting (u -> v) if directional, or any undirected between u & v
  function pickEdgeBetween(u, v) {
    let hit = visibleEdges().filter(e => e.data('source') === u && e.data('target') === v);
    if (hit.length) return hit[0];
    // undirected: allow reverse if edge.directional == false
    hit = visibleEdges().filter(e => !e.data('directional') && (
      (e.data('source') === u && e.data('target') === v) ||
      (e.data('source') === v && e.data('target') === u)
    ));
    return hit.length ? hit[0] : cy.collection();
  }

  // Build adjacency respecting per-edge direction
  function buildAdj() {
    const adj = new Map(); // id -> Set<id>
    visibleEdges().forEach(e => {
      const s = e.data('source'), t = e.data('target'), dir = !!e.data('directional');
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s).add(t);
      if (!dir) adj.get(t).add(s);
    });
    return adj;
  }

  // Unweighted shortest path (BFS), per-edge directedness
  function shortestPathIds(srcId, tgtId) {
    if (srcId === tgtId) return [srcId];
    const adj = buildAdj();
    const prev = new Map([[srcId, null]]);
    const q = [srcId];
    while (q.length) {
      const u = q.shift();
      const nb = adj.get(u) || new Set();
      for (const v of nb) {
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === tgtId) {
          const out = [];
          let cur = v;
          while (cur !== null) { out.push(cur); cur = prev.get(cur); }
          out.reverse();
          return out;
        }
        q.push(v);
      }
    }
    return null;
  }

  // Upstream/Downstream flood (N hops) with per-edge direction.
  // Uses node.connectedEdges() per frontier node — O(V+E) instead of O(V×E).
  function floodFrom(startId, depth, mode /* 'up'|'down' */) {
    const visNodes = visibleNodeIdsSet();
    const visited = new Set([startId]);
    let frontier = [startId];
    const steps = Math.max(1, depth | 0);

    for (let h = 0; h < steps; h++) {
      const next = [];
      for (const u of frontier) {
        const uNode = cy.getElementById(u);
        if (!uNode || !uNode.nonempty || !uNode.nonempty()) continue;
        uNode.connectedEdges(':visible').forEach(e => {
          const s = e.data('source'), t = e.data('target'), dir = !!e.data('directional');
          if (mode === 'down') {
            if (u === s && visNodes.has(t) && !visited.has(t)) { visited.add(t); next.push(t); }
            if (!dir && u === t && visNodes.has(s) && !visited.has(s)) { visited.add(s); next.push(s); }
          } else { // 'up'
            if (u === t && visNodes.has(s) && !visited.has(s)) { visited.add(s); next.push(s); }
            if (!dir && u === s && visNodes.has(t) && !visited.has(t)) { visited.add(t); next.push(t); }
          }
        });
      }
      frontier = next;
      if (!frontier.length) break;
    }

    // Build element collection
    const nodes = cy.collection(Array.from(visited).map(id => cy.getElementById(id)));
    const edges = visibleEdges().filter(e => {
      const s = e.data('source'), t = e.data('target'), dir = !!e.data('directional');
      if (!visited.has(s) || !visited.has(t)) return false;
      if (!dir) return true;
      // For directional edges: downstream keeps s→t edges, upstream keeps t→s edges.
      return mode === 'down' ? visited.has(s) : visited.has(t);
    });
    return nodes.union(edges);
  }

  // Public actions
  function shortestTo(targetNode) {
    if (!pathState.src) { window.showTransientMessage?.('Pick a source first (Start path from here…)'); return; }
    const srcId = pathState.src.id(), tgtId = targetNode.id();
    const ids = shortestPathIds(srcId, tgtId);
    if (!ids) { window.showTransientMessage?.('No path found on current visible graph.'); return; }
    // Build element collection along the found chain
    let col = cy.collection();
    for (const id of ids) col = col.union(cy.getElementById(id));
    for (let i = 0; i < ids.length - 1; i++) {
      const e = pickEdgeBetween(ids[i], ids[i + 1]);
      if (e && e.nonempty && e.nonempty()) col = col.union(e);
    }
    highlight(col, 'path');
    window.showTransientMessage?.(`Shortest path (${ids.length - 1} hops)`);
  }

  function upstreamFrom(node, depth /* optional */) {
    const d = depth ?? state.focusDepth ?? 2;
    const col = floodFrom(node.id(), d, 'up');
    highlight(col, 'upstream');
    window.showTransientMessage?.(`Upstream ${d}-hop`);
  }

  function downstreamFrom(node, depth /* optional */) {
    const d = depth ?? state.focusDepth ?? 2;
    const col = floodFrom(node.id(), d, 'down');
    highlight(col, 'downstream');
    window.showTransientMessage?.(`Downstream ${d}-hop`);
  }

  // Expose
  window.onexusPath = { beginFrom, cancel, shortestTo, upstreamFrom, downstreamFrom, clearHighlight };

  // --- convenience resets ---
  // Click on empty canvas: clear path highlight and cancel pending source
  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      clearHighlight();
      cancel();
      window.showTransientMessage?.('Path highlight cleared');
    }
  });

  // ESC: clear path highlight and cancel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearHighlight();
      cancel();
      window.showTransientMessage?.('Path selection cancelled');
    }
  });

  // Init chip (in case toolbar exists at load)
  ensurePathChip();
})();