/* ONEXUS – Animation (Solar parent-orbit & Black Hole spiral-in, fixes)
   Modes: off | bounce | orbit | blackhole | breath
   Public API unchanged: setAnimMode, setAnimIntensity, setAnimSpeed,
   setAnimScope, setAnimRespectLayout, toggleAnimRunning, resetAnimPrefs
*/
(function () {
  const PREF = {
    mode: 'onexus.anim.mode',
    intensity: 'onexus.anim.intensity',
    speed: 'onexus.anim.speed',
    scope: 'onexus.anim.scope',
    respect: 'onexus.anim.respectLayout',
    running: 'onexus.anim.running',
  };

  const ALLOWED_MODES = new Set(['off', 'bounce', 'orbit', 'blackhole', 'breath', 'edgeflow']);
  const LEGACY_MODE_MAP = Object.freeze({
    solar: 'orbit',
    pulse: 'breath',
    gravity: 'blackhole',
    modal: 'bounce',
  });

  const readPref = (k, d) => localStorage.getItem(k) ?? d;
  const writePref = (k, v) => localStorage.setItem(k, String(v));
  const delPref = (k) => localStorage.removeItem(k);

  const anim = {
    running: false,
    mode: 'off',
    intensity: 12,
    speed: 1.0,
    scope: 'all', // 'all' | 'selection'
    respectLayout: true,

    basePos: new Map(),   // id -> {x,y}
    baseR: new Map(),     // id -> radius (blackhole)
    baseSize: new Map(),  // id -> {w,h}  (blackhole)
    raf: null,
    t0: 0,
    last: 0,
    maxFps: 60,
    parentMap: new Map(), // id(child) -> id(parent)  (orbit)
    holeOverlay: null,    // HTMLElement
    edgeFlow: { dimension: null, pattern: [10, 6] },
    orbitDepthScale: 0.20, // +20% radius per depth level
  };

  // Allow UI to set specific anim fields at runtime (safe narrow hook)
  window.__onexus_anim_hook = function (key, value) {
    try { if (key in anim) anim[key] = value; } catch { }
  };

  // ---------- utils ----------
  function sanitizeMode(m) {
    const lower = String(m ?? '').toLowerCase();
    const migrated = LEGACY_MODE_MAP[lower] ?? lower;
    return ALLOWED_MODES.has(migrated) ? migrated : 'off';
  }
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }
  const isCyReady = () => !!window.cy && typeof window.cy.nodes === 'function';
  function getGraphCenter(cy) {
    const bb = cy.elements(':visible').boundingBox();
    return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }
  function getTargetNodes(cy) {
    if (anim.scope !== 'selection') return cy.nodes(':visible');
    const sel = cy.$('node:selected');
    if (sel && sel.length > 0) {
      const hood = sel.closedNeighborhood().nodes(':visible');
      return hood.length > 0 ? hood : sel;
    }
    return cy.nodes(':visible');
  }
  function cacheBasePositions(cy) {
    anim.basePos.clear();
    cy.nodes(':visible').forEach(n => {
      const p = n.position();
      anim.basePos.set(n.id(), { x: p.x, y: p.y });
    });
  }
  function restoreBasePositions(cy) {
    cy.nodes().positions(n => anim.basePos.get(n.id()) ?? n.position());
  }
  function clearPerNodeOverrides() {
    if (!isCyReady()) return;
    const cy = window.cy;
    cy.nodes().forEach(n => n.style({ width: null, height: null, opacity: null }));
  }

  // Build child->parent map with strong container bias.
  // Returns: { map, parentSet }
  function buildParentMap(cy) {
    const CONTAINER_TYPES = new Set(['System', 'Space', 'Organization', 'ComponentType', 'Zone', 'Building', 'Storey']);
    const PREFERRED_TYPES = new Set(['PartOfSystem', 'LocatedIn', 'OfType', 'InZone', 'PortOf', 'FillsOpeningIn']);

    const map = new Map();       // childId -> parentId
    const parentSet = new Set(); // all parentIds
    const visible = new Set(cy.nodes(':visible').map(n => n.id()));

    const nodeType = (id) => cy.getElementById(id)?.data('nodeType') || '';
    const isContainer = (id) => CONTAINER_TYPES.has(nodeType(id));
    const outPartCount = (id) => cy.$(`edge[type = "PartOfSystem"][source = "${id}"]`).length;
    const inPartCount = (id) => cy.$(`edge[type = "PartOfSystem"][target = "${id}"]`).length;

    const setParent = (child, parent) => {
      if (!visible.has(child) || !visible.has(parent)) return;
      if (child === parent) return;
      if (!map.has(child)) { map.set(child, parent); parentSet.add(parent); }
    };

    cy.edges(':visible').forEach(e => {
      const d = e.data(); const typ = d.type || ''; if (!PREFERRED_TYPES.has(typ)) return;
      const s = d.source, t = d.target, dir = !!d.directional;

      if (typ === 'PartOfSystem') {
        // 1) clear parent/child on directed edges (parent→child)
        if (dir) { setParent(t, s); return; }
        // 2) undirected membership: pick container side as parent
        if (isContainer(t) && !isContainer(s)) return setParent(s, t);
        if (isContainer(s) && !isContainer(t)) return setParent(t, s);
        // 3) tie-breaker: pick the node that "owns" more parts as parent
        const sScore = outPartCount(s) - inPartCount(s);
        const tScore = outPartCount(t) - inPartCount(t);
        if (tScore > sScore) setParent(s, t); else setParent(t, s);
        return;
      }

      // Non-ambiguous relations: entity (source) → container (target)
      // LocatedIn / OfType / InZone / PortOf / FillsOpeningIn
      setParent(s, t);
    });

    // Remove trivial 2-cycles (A->B & B->A): prefer keeping the container as parent
    for (const [c, p] of map) {
      if (map.get(p) === c) {
        if (isContainer(p) && !isContainer(c)) map.delete(p);
        else map.delete(c);
      }
    }

    return { map, parentSet };
  }

  // ---------- black hole overlay ----------
  function ensureBlackHoleOverlay() {
    if (anim.holeOverlay && anim.holeOverlay.isConnected) return anim.holeOverlay;
    const wrap = window.cy?.container();
    if (!wrap) return null;
    const el = document.createElement('div');
    anim.holeOverlay = el;
    Object.assign(el.style, {
      position: 'absolute',
      width: '160px',
      height: '160px',
      left: '0px',
      top: '0px',
      transform: 'translate(-50%, -50%)', // we’ll position with pixel coordinates per frame
      borderRadius: '50%',
      pointerEvents: 'none',
      background: 'radial-gradient(closest-side, rgba(0,0,0,0.95), rgba(0,0,0,0.2) 60%, rgba(0,0,0,0) 100%)',
      boxShadow: '0 0 80px 30px rgba(0,0,0,0.25) inset',
      zIndex: 4
    });
    wrap.appendChild(el);
    return el;
  }
  function hideBlackHoleOverlay() {
    if (anim.holeOverlay) { try { anim.holeOverlay.remove(); } catch { } }
    anim.holeOverlay = null;
  }
  // Convert graph (model) coords -> screen coords on Cytoscape container
  function graphToScreen(pt) {
    const cy = window.cy; const z = cy.zoom(); const pan = cy.pan();
    return { x: pt.x * z + pan.x, y: pt.y * z + pan.y };
  }

  // ---------- modes ----------
  function applyBounce(cy, t) {
    const nodes = getTargetNodes(cy);
    const amp = Math.max(0, anim.intensity) * 1.6;
    const freq = 1.2 * anim.speed;
    const omega = 2 * Math.PI * freq;
    const sel = cy.$('node:selected')[0];
    const src = sel ? sel.position() : getGraphCenter(cy);
    nodes.forEach(n => {
      const base = anim.basePos.get(n.id()); if (!base) return;
      const dx = base.x - src.x, dy = base.y - src.y, r = Math.hypot(dx, dy);
      const phase = r * 0.015, seed = hash01(n.id());
      const a = amp * (0.35 + 0.65 * seed);
      n.position({
        x: base.x + a * Math.sin(omega * t + phase),
        y: base.y + a * Math.cos(omega * t * 0.92 + phase + seed * 2),
      });
    });
  }

  function applyBreath(cy, t) {
    const nodes = getTargetNodes(cy);
    const center = getGraphCenter(cy);
    const s = 1 + (Math.sin(t * 1.2 * anim.speed) * (anim.intensity / 80));
    nodes.forEach(n => {
      const base = anim.basePos.get(n.id()); if (!base) return;
      n.position({
        x: center.x + (base.x - center.x) * s,
        y: center.y + (base.y - center.y) * s,
      });
    });
  }

  // SOLAR (fixed): child orbits its parent (parent stays put)
  function applyOrbit(cy, t) {
    if (!anim.parentMapInfo || !anim.parentMapInfo.map?.size) {
      anim.parentMapInfo = buildParentMap(cy); // { map, parentSet }
    }
    const parentMap = anim.parentMapInfo.map;
    const parentSet = anim.parentMapInfo.parentSet;

    const speed = 1.2 * anim.speed;
    // IMPORTANT: only animate targets (Selection + Neighborhood OR All)
    const targets = getTargetNodes(cy);

    targets.forEach(n => {
      const nid = n.id();
      const base = anim.basePos.get(nid);
      if (!base) return;

      // If this node acts as a parent of any other node, DO NOT move it.
      if (parentSet.has(nid)) return;

      const pId = parentMap.get(nid);
      if (!pId) {
        // Non-parent root in target set: small wobble only
        const seed = ((nid.charCodeAt(0) * 131 + nid.length * 17) % 1000) / 1000;
        const a = (anim.intensity * 0.15) * (0.5 + 0.5 * seed);
        n.position({
          x: base.x + a * Math.sin(t * 0.9 + seed * 7),
          y: base.y + a * Math.cos(t * 1.1 + seed * 5),
        });
        return;
      }

      // Child: orbit around the parent's CURRENT position
      const p = cy.getElementById(pId);
      const pPos = (p && p.position) ? p.position() : (anim.basePos.get(pId) || base);

      // radius from initial child-to-parentBase vector
      const pBase = anim.basePos.get(pId) || pPos;
      let dx = base.x - pBase.x, dy = base.y - pBase.y;
      let r = Math.hypot(dx, dy);
      if (!Number.isFinite(r) || r < 10) r = 30 + (anim.intensity * 1.2);

      const seed = ((nid.charCodeAt(0) * 313 + nid.length * 29) % 1000) / 1000;
      const omega = speed * (0.9 + 0.6 * seed);
      const ang = (t * omega) + (seed * Math.PI * 2);
      const wob = 1.0 + 0.06 * Math.sin(t * 1.7 + seed * 13);

      // … keep existing n.position({ x: ..., y: ... }) here …

      n.position({
        x: pPos.x + r * wob * Math.cos(ang),
        y: pPos.y + r * wob * Math.sin(ang),
      });
    });
  }

  // BLACKHOLE (aligned): overlay follows graph center; nodes spiral in, shrink, fade, vanish
  function applyBlackHole(cy, t) {
    const hole = ensureBlackHoleOverlay();

    const center = getGraphCenter(cy);
    // move overlay to the same (graph) center projected into screen coords
    if (hole) {
      const s = graphToScreen(center);
      hole.style.left = `${s.x}px`;
      hole.style.top = `${s.y}px`;
    }

    const nodes = getTargetNodes(cy);
    // cache initial r and size
    nodes.forEach(n => {
      const id = n.id();
      if (!anim.basePos.has(id)) return;
      if (!anim.baseR.has(id)) {
        const b = anim.basePos.get(id);
        const r0 = Math.hypot(b.x - center.x, b.y - center.y);
        anim.baseR.set(id, Math.max(10, r0));
      }
      if (!anim.baseSize.has(id)) {
        const w = parseFloat(n.style('width')) || 50;
        const h = parseFloat(n.style('height')) || w;
        anim.baseSize.set(id, { w, h });
      }
    });

    const k = 0.15 * (anim.speed);
    const spin = 1.1 * anim.speed;
    const pull = 60 + anim.intensity * 4;

    nodes.forEach(n => {
      const id = n.id();
      const base = anim.basePos.get(id); if (!base) return;

      const r0 = anim.baseR.get(id) ?? Math.hypot(base.x - center.x, base.y - center.y);
      let r = r0 * Math.exp(-k * t);
      r = Math.max(0, Math.min(r, r0 - pull * Math.min(t, r0 / Math.max(1, pull))));

      const seed = hash01(id);
      const ang = (t * spin) + seed * 6.28318;
      const wob = 1.0 + 0.05 * Math.sin(t * 2.0 + seed * 9);

      n.position({
        x: center.x + r * wob * Math.cos(ang),
        y: center.y + r * wob * Math.sin(ang),
      });

      const ratio = r / (r0 || 1);
      const baseSz = anim.baseSize.get(id) || { w: 50, h: 50 };
      const scale = Math.max(0.05, Math.pow(ratio, 1.2));
      n.style('width', baseSz.w * scale);
      n.style('height', baseSz.h * scale);
      n.style('opacity', Math.max(0, Math.min(1, ratio * 1.2)));

      if (r < 6) {
        n.style('opacity', 0);
        n.style('width', 2);
        n.style('height', 2);
      }
    });
  }

  // ---------- loop ----------
  function applyFrame(cy, t) {
    switch (anim.mode) {
      case 'bounce': return applyBounce(cy, t);
      case 'orbit': return applyOrbit(cy, t);
      case 'blackhole': return applyBlackHole(cy, t);
      case 'breath': return applyBreath(cy, t);
      case 'edgeflow': return applyEdgeFlow(cy, t);
      default: return;
    }
  }

  function tick(now) {
    if (!anim.running) return;
    const cy = window.cy; if (!cy) return;
    const minDelta = 1000 / anim.maxFps;
    if (anim.last && (now - anim.last) < minDelta) {
      anim.raf = requestAnimationFrame(tick);
      return;
    }
    anim.last = now;
    const t = (now - anim.t0) / 1000;
    applyFrame(cy, t);
    anim.raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!isCyReady()) return;
    const cy = window.cy;
    anim.running = true;
    anim.t0 = performance.now();
    anim.last = 0;
    cacheBasePositions(cy);
    anim.parentMap = new Map(); // rebuild on start
    if (!window.__onexus_anim_layout_hooked) {
      window.__onexus_anim_layout_hooked = true;
      window.cy.on('layoutstop', () => { if (anim.running && anim.respectLayout) cacheBasePositions(window.cy); });
    }
    // do NOT persist running=1 automatically (we keep OFF by default); set only on explicit toggle
    anim.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!isCyReady()) return;
    anim.running = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = null;
    restoreBasePositions(window.cy);
    clearPerNodeOverrides();
    hideBlackHoleOverlay();
    anim.baseR.clear();
    anim.baseSize.clear();
  }

  function syncUi() {
    const $mode = document.getElementById('animMode');
    const $int = document.getElementById('animIntensity');
    const $spd = document.getElementById('animSpeed');
    const $scope = document.getElementById('animScope');
    const $respect = document.getElementById('animRespectLayout');
    const $badge = document.getElementById('animStatus');
    if ($mode && $mode.value !== anim.mode) $mode.value = anim.mode;
    if ($int) $int.value = String(anim.intensity);
    if ($spd) $spd.value = String(anim.speed);
    if ($scope) $scope.value = anim.scope;
    if ($respect) $respect.checked = !!anim.respectLayout;
    if ($badge) $badge.textContent = anim.running ? 'Running' : 'Stopped';
  }

  function applyEdgeFlow(cy, t) {
    // targets: respect selection scope
    const targets = getTargetNodes(cy);
    const targetIds = new Set(targets.map(n => n.id()));

    // filter edges by dimension (if set)
    const dim = anim.edgeFlow.dimension; // null => all
    let edges = cy.edges(':visible');
    if (dim) edges = edges.filter(e => (e.data('dimension') === dim));

    // limit to edges touching target set when scope=selection
    if (anim.scope === 'selection') {
      edges = edges.filter(e => targetIds.has(e.data('source')) || targetIds.has(e.data('target')));
    }

    // apply dashed style and animate offset
    const dash = anim.edgeFlow.pattern || [10, 6];
    const offset = (t * 60 * anim.speed) % (dash[0] + dash[1]);
    edges.forEach(e => {
      e.style({
        'line-style': 'dashed',
        'line-dash-pattern': dash,
        'line-dash-offset': offset
      });
    });
  }

  function computeDepth(parentMap, id) {
    let d = 0, cur = id, guard = 0;
    while (parentMap.has(cur) && guard++ < 64) { d++; cur = parentMap.get(cur); }
    return d;
  }

  // ---------- API ----------
  window.setAnimMode = (mode) => {
    const m = sanitizeMode(mode);
    if (anim.mode === m) return;
    if (anim.mode === 'blackhole') hideBlackHoleOverlay();
    clearPerNodeOverrides();

    anim.mode = m;
    // persist mode, but don't auto-run
    writePref(PREF.mode, anim.mode);
    if (anim.mode === 'off') {
      stop();
      writePref(PREF.running, '0');
    } else {
      cacheBasePositions(window.cy);
      anim.parentMap = new Map();
      if (anim.running) {
        // continue
      } else {
        // remain OFF until user toggles
      }
      if (anim.mode === 'blackhole') ensureBlackHoleOverlay();
    }
    syncUi();
  };
  window.setAnimIntensity = (v) => { anim.intensity = Math.max(0, parseFloat(v ?? '0')); writePref(PREF.intensity, anim.intensity); syncUi(); };
  window.setAnimSpeed = (v) => { anim.speed = Math.max(0.05, parseFloat(v ?? '1')); writePref(PREF.speed, anim.speed); syncUi(); };
  window.setAnimScope = (scope) => {
    anim.scope = (scope === 'selection') ? 'selection' : 'all';
    writePref(PREF.scope, anim.scope);
    cacheBasePositions(window.cy);
    anim.parentMap = new Map();
    syncUi();
  };
  window.setAnimRespectLayout = (checked) => { anim.respectLayout = !!checked; writePref(PREF.respect, anim.respectLayout ? '1' : '0'); syncUi(); };
  window.toggleAnimRunning = () => {
    if (anim.mode === 'off') { window.setAnimMode('bounce'); } // pick a default mode
    if (anim.running) {
      stop(); writePref(PREF.running, '0');
    } else {
      start(); writePref(PREF.running, '1');
    }
    syncUi();
  };
  window.resetAnimPrefs = () => {
    Object.keys(localStorage).filter(k => k.startsWith('onexus.anim.')).forEach(k => delPref(k));
    stop();
    anim.mode = 'off';
    anim.intensity = 12;
    anim.speed = 1.0;
    anim.scope = 'all';
    anim.respectLayout = true;
    cacheBasePositions(window.cy);
    writePref(PREF.mode, 'off');
    writePref(PREF.running, '0');
    syncUi();
  };
  // Set flow dimension: null|'System'|'Spatial'|'Responsibility'|'Vendor'
  window.setEdgeFlowDimension = (dimOrNull) => { anim.edgeFlow.dimension = dimOrNull || null; };
  // Set flow dash pattern
  window.setEdgeFlowPattern = (a = 10, b = 6) => { anim.edgeFlow.pattern = [a, b]; };

  // Phase reveal playback
  window.playPhaseReveal = async function playPhaseReveal({ order = [], perPhaseMs = 700, includeNodes = true } = {}) {
    const cy = window.cy; if (!cy) return;
    // reset visibility
    cy.edges().style('display', 'none'); if (includeNodes) cy.nodes().style('display', 'none');

    const uniq = (arr) => [...new Set(arr)];
    const phases = order.length ? order : uniq(cy.edges().map(e => (e.data('phase') || [])).flat());
    for (const ph of phases) {
      const batch = cy.edges().filter(e => (e.data('phase') || []).some(x => String(x) === String(ph)));
      batch.style('display', 'element');
      if (includeNodes) {
        const touched = batch.connectedNodes();
        touched.style('display', 'element');
      }
      window.buildRelationshipLegend?.(); window.updateMetrics?.();
      await new Promise(r => setTimeout(r, perPhaseMs));
    }
  };
  window.stopPhaseReveal = function stopPhaseReveal() {
    const cy = window.cy; if (!cy) return;
    cy.edges().style('display', 'element'); cy.nodes().style('display', 'element');
    window.buildRelationshipLegend?.(); window.updateMetrics?.();
  };

  // ---------- boot ----------
  function migrateAnimPrefs() {
    const raw = readPref(PREF.mode, 'off');
    const sane = sanitizeMode(raw);
    if (sane !== raw) writePref(PREF.mode, sane);
  }

  document.addEventListener('DOMContentLoaded', () => {
    migrateAnimPrefs(); // maps legacy values  [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/cobie-importer.js)

    // Force default OFF on boot (ignore persisted "running")
    anim.mode = 'off';
    writePref(PREF.mode, 'off');
    writePref(PREF.running, '0');

    // Load tunables but keep animation stopped
    anim.intensity = parseFloat(readPref(PREF.intensity, String(anim.intensity)));
    anim.speed = parseFloat(readPref(PREF.speed, String(anim.speed)));
    anim.scope = readPref(PREF.scope, 'all');
    anim.respectLayout = readPref(PREF.respect, '1') !== '0';

    // Prepare cache; DO NOT start animation automatically
    setTimeout(() => {
      if (isCyReady()) cacheBasePositions(window.cy);
      hideBlackHoleOverlay();
      syncUi();
    }, 80);
  });
})();