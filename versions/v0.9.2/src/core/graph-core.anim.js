/* ONEXUS – Animation (Solar parent-orbit & Black Hole spiral-in, fixes)
 Modes: off | bounce | orbit | blackhole | breath | edgeflow
 Public API unchanged:
  setAnimMode, setAnimIntensity, setAnimSpeed, setAnimScope, setAnimRespectLayout,
  toggleAnimRunning, resetAnimPrefs, setEdgeFlowDimension, setEdgeFlowPattern
*/
(function () {
  const PREF = {
    mode: "onexus.anim.mode",
    intensity: "onexus.anim.intensity",
    speed: "onexus.anim.speed",
    scope: "onexus.anim.scope",
    respect: "onexus.anim.respectLayout",
    running: "onexus.anim.running",
  };

  const ALLOWED_MODES = new Set(["off", "bounce", "orbit", "blackhole", "breath", "edgeflow"]);
  const LEGACY_MODE_MAP = Object.freeze({
    solar: "orbit",
    pulse: "breath",
    gravity: "blackhole",
    modal: "bounce",
  });

  const readPref = (k, d) => localStorage.getItem(k) ?? d;
  const writePref = (k, v) => localStorage.setItem(k, String(v));
  const delPref = (k) => localStorage.removeItem(k);

  const anim = {
    running: false,
    mode: "off",
    intensity: 12,
    speed: 1.0,
    scope: "all", // 'all' | 'selection'
    respectLayout: true,
    basePos: new Map(), // id -> {x,y}
    baseR: new Map(),   // id -> radius (blackhole)
    baseSize: new Map(),// id -> {w,h} (blackhole)
    raf: null,
    t0: 0,
    last: 0,
    maxFps: 60,

    // orbit
    parentMapInfo: null, // { map, parentSet }
    orbitDepthScale: 0.20, // +20% radius per depth level

    // edgeflow
    edgeFlow: { dimension: null, pattern: [10, 6] },

    // overlay
    holeOverlay: null,
  };

  // Allow UI to set anim fields at runtime (safe narrow hook)
  window.__onexus_anim_hook = function (key, value) {
    try { if (key in anim) anim[key] = value; } catch { }
  };

  // ---------- utils ----------
  function sanitizeMode(m) {
    const lower = String(m ?? "").toLowerCase();
    const migrated = LEGACY_MODE_MAP[lower] ?? lower;
    return ALLOWED_MODES.has(migrated) ? migrated : "off";
  }

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }

  const isCyReady = () => !!window.cy && typeof window.cy.nodes === "function";

  function getGraphCenter(cy) {
    const bb = cy.elements(":visible").boundingBox();
    return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }

  function getTargetNodes(cy) {
    if (anim.scope !== "selection") return cy.nodes(":visible");
    const sel = cy.$("node:selected");
    if (sel && sel.length > 0) {
      const hood = sel.closedNeighborhood().nodes(":visible");
      return hood.length > 0 ? hood : sel;
    }
    return cy.nodes(":visible");
  }

  function cacheBasePositions(cy) {
    anim.basePos.clear();
    cy.nodes(":visible").forEach(n => {
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
    cy.nodes().forEach(n => n.style({ width: null, height: null, opacity: null, "line-style": null }));
  }

  function clearEdgeOverrides() {
    if (!isCyReady()) return;
    const cy = window.cy;
    cy.edges().forEach(e => e.style({
      "line-style": null,
      "line-dash-pattern": null,
      "line-dash-offset": null
    }));
  }

  // Build child->parent map with strong container bias.
  // Returns: { map, parentSet }
  function buildParentMap(cy) {
    const CONTAINER_TYPES = new Set(["System", "Space", "Organization", "ComponentType", "Zone", "Building", "Storey"]);
    const PREFERRED_TYPES = new Set(["PartOfSystem", "LocatedIn", "OfType", "InZone", "PortOf", "FillsOpeningIn"]);

    const map = new Map();      // childId -> parentId
    const parentSet = new Set();// all parentIds
    const visible = new Set(cy.nodes(":visible").map(n => n.id()));

    const nodeType = (id) => cy.getElementById(id)?.data("nodeType") ?? "";
    const isContainer = (id) => CONTAINER_TYPES.has(nodeType(id));

    const outPartCount = (id) => cy.$(`edge[type = "PartOfSystem"][source = "${id}"]`).length;
    const inPartCount = (id) => cy.$(`edge[type = "PartOfSystem"][target = "${id}"]`).length;

    const setParent = (child, parent) => {
      if (!visible.has(child) || !visible.has(parent)) return;
      if (child === parent) return;
      if (!map.has(child)) { map.set(child, parent); parentSet.add(parent); }
    };

    cy.edges(":visible").forEach(e => {
      const d = e.data();
      const typ = d.type ?? "";
      if (!PREFERRED_TYPES.has(typ)) return;

      const s = d.source, t = d.target, dir = !!d.directional;

      if (typ === "PartOfSystem") {
        // 1) directed parent->child
        if (dir) { setParent(t, s); return; }

        // 2) undirected membership: container side is parent
        if (isContainer(t) && !isContainer(s)) { setParent(s, t); return; }
        if (isContainer(s) && !isContainer(t)) { setParent(t, s); return; }

        // 3) tie-breaker: pick owner-like node
        const sScore = outPartCount(s) - inPartCount(s);
        const tScore = outPartCount(t) - inPartCount(t);
        if (tScore > sScore) setParent(s, t); else setParent(t, s);
        return;
      }

      // Non-ambiguous: entity(source) -> container(target)
      setParent(s, t);
    });

    // Remove trivial 2-cycles (A->B and B->A)
    for (const [c, p] of map) {
      if (map.get(p) === c) {
        if (isContainer(p) && !isContainer(c)) map.delete(p);
        else map.delete(c);
      }
    }
    return { map, parentSet };
  }

  function computeDepth(parentMap, id) {
    let d = 0, cur = id, guard = 0;
    while (parentMap.has(cur) && guard++ < 64) { d++; cur = parentMap.get(cur); }
    return d;
  }

  // ---------- black hole overlay ----------
  function ensureBlackHoleOverlay() {
    if (anim.holeOverlay && anim.holeOverlay.isConnected) return anim.holeOverlay;
    const wrap = window.cy?.container();
    if (!wrap) return null;

    const el = document.createElement("div");
    anim.holeOverlay = el;
    Object.assign(el.style, {
      position: "absolute",
      width: "160px",
      height: "160px",
      left: "0px",
      top: "0px",
      transform: "translate(-50%, -50%)",
      borderRadius: "50%",
      pointerEvents: "none",
      background: "radial-gradient(closest-side, rgba(0,0,0,0.95), rgba(0,0,0,0.2) 60%, rgba(0,0,0,0) 100%)",
      boxShadow: "0 0 80px 30px rgba(0,0,0,0.25) inset",
      zIndex: 4
    });

    wrap.appendChild(el);
    return el;
  }

  function hideBlackHoleOverlay() {
    if (anim.holeOverlay) { try { anim.holeOverlay.remove(); } catch { } }
    anim.holeOverlay = null;
  }

  function graphToScreen(pt) {
    const cy = window.cy;
    const z = cy.zoom();
    const pan = cy.pan();
    return { x: pt.x * z + pan.x, y: pt.y * z + pan.y };
  }

  // ---------- modes ----------
  function applyBounce(cy, t) {
    const nodes = getTargetNodes(cy);
    const amp = Math.max(0, anim.intensity) * 1.6;
    const freq = 1.2 * anim.speed;
    const omega = 2 * Math.PI * freq;

    const sel = cy.$("node:selected")[0];
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

  // ORBIT: child orbits its parent; parents stay put. Depth scales orbit radius.
  function applyOrbit(cy, t) {
    if (!anim.parentMapInfo || !anim.parentMapInfo.map?.size) {
      anim.parentMapInfo = buildParentMap(cy); // { map, parentSet }
    }
    const parentMap = anim.parentMapInfo.map;
    const parentSet = anim.parentMapInfo.parentSet;

    const speed = 1.2 * anim.speed;
    const targets = getTargetNodes(cy);

    targets.forEach(n => {
      const nid = n.id();
      const base = anim.basePos.get(nid);
      if (!base) return;

      // do not move parents
      if (parentSet.has(nid)) return;

      const pId = parentMap.get(nid);
      if (!pId) {
        // small wobble for roots
        const seed = ((nid.charCodeAt(0) * 131 + nid.length * 17) % 1000) / 1000;
        const a = (anim.intensity * 0.15) * (0.5 + 0.5 * seed);
        n.position({
          x: base.x + a * Math.sin(t * 0.9 + seed * 7),
          y: base.y + a * Math.cos(t * 1.1 + seed * 5),
        });
        return;
      }

      const p = cy.getElementById(pId);
      const pPos = (p && p.position) ? p.position() : (anim.basePos.get(pId) ?? base);

      const pBase = anim.basePos.get(pId) ?? pPos;
      let dx = base.x - pBase.x, dy = base.y - pBase.y;
      let r = Math.hypot(dx, dy);
      if (!Number.isFinite(r) || r < 10) r = 30 + (anim.intensity * 1.2);

      // depth scaling (unfinished previously): deeper children orbit further
      const depth = computeDepth(parentMap, nid);
      const depthScale = Math.max(0, Math.min(0.5, Number(anim.orbitDepthScale ?? 0.2)));
      const rScaled = r * (1 + depth * depthScale);

      const seed = ((nid.charCodeAt(0) * 313 + nid.length * 29) % 1000) / 1000;
      const omega = speed * (0.9 + 0.6 * seed);
      const ang = (t * omega) + (seed * Math.PI * 2);
      const wob = 1.0 + 0.06 * Math.sin(t * 1.7 + seed * 13);

      n.position({
        x: pPos.x + rScaled * wob * Math.cos(ang),
        y: pPos.y + rScaled * wob * Math.sin(ang),
      });
    });
  }

  // BLACKHOLE: overlay follows center; nodes spiral in, shrink, fade
  function applyBlackHole(cy, t) {
    const hole = ensureBlackHoleOverlay();
    const center = getGraphCenter(cy);

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
        const w = parseFloat(n.style("width")) || 50;
        const h = parseFloat(n.style("height")) || w;
        anim.baseSize.set(id, { w, h });
      }
    });

    const k = 0.15 * anim.speed;
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
      const baseSz = anim.baseSize.get(id) ?? { w: 50, h: 50 };
      const scale = Math.max(0.05, Math.pow(ratio, 1.2));

      n.style("width", baseSz.w * scale);
      n.style("height", baseSz.h * scale);
      n.style("opacity", Math.max(0, Math.min(1, ratio * 1.2)));

      if (r < 6) {
        n.style("opacity", 0);
        n.style("width", 2);
        n.style("height", 2);
      }
    });
  }

  function applyEdgeFlow(cy, t) {
    const targets = getTargetNodes(cy);
    const targetIds = new Set(targets.map(n => n.id()));

    const dim = anim.edgeFlow.dimension; // null => all
    let edges = cy.edges(":visible");
    if (dim) edges = edges.filter(e => (e.data("dimension") === dim));

    if (anim.scope === "selection") {
      edges = edges.filter(e => targetIds.has(e.data("source")) || targetIds.has(e.data("target")));
    }

    const dash = anim.edgeFlow.pattern ?? [10, 6];
    const cycle = (dash[0] + dash[1]) || 16;
    const offset = (t * 60 * anim.speed) % cycle;

    edges.forEach(e => {
      e.style({
        "line-style": "dashed",
        "line-dash-pattern": dash,
        "line-dash-offset": offset
      });
    });
  }

  // ---------- loop ----------
  function applyFrame(cy, t) {
    switch (anim.mode) {
      case "bounce": return applyBounce(cy, t);
      case "orbit": return applyOrbit(cy, t);
      case "blackhole": return applyBlackHole(cy, t);
      case "breath": return applyBreath(cy, t);
      case "edgeflow": return applyEdgeFlow(cy, t);
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
    anim.parentMapInfo = null;

    if (!window.__onexus_anim_layout_hooked) {
      window.__onexus_anim_layout_hooked = true;
      window.cy.on("layoutstop", () => { if (anim.running && anim.respectLayout) cacheBasePositions(window.cy); });
    }

    anim.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!isCyReady()) return;

    anim.running = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = null;

    restoreBasePositions(window.cy);

    clearPerNodeOverrides();
    clearEdgeOverrides();

    hideBlackHoleOverlay();
    anim.baseR.clear();
    anim.baseSize.clear();
    anim.parentMapInfo = null;
  }

  function syncUi() {
    const $mode = document.getElementById("animMode");
    const $int = document.getElementById("animIntensity");
    const $spd = document.getElementById("animSpeed");
    const $scope = document.getElementById("animScope");
    const $respect = document.getElementById("animRespectLayout");
    const $badge = document.getElementById("animStatus");

    if ($mode && $mode.value !== anim.mode) $mode.value = anim.mode;
    if ($int) $int.value = String(anim.intensity);
    if ($spd) $spd.value = String(anim.speed);
    if ($scope) $scope.value = anim.scope;
    if ($respect) $respect.checked = !!anim.respectLayout;
    if ($badge) $badge.textContent = anim.running ? "Running" : "Stopped";
  }

  // ---------- API ----------
  window.setAnimMode = (mode) => {
    const m = sanitizeMode(mode);
    if (anim.mode === m) return;

    // leaving edgeflow -> cleanup edge styles
    if (anim.mode === "edgeflow") clearEdgeOverrides();
    if (anim.mode === "blackhole") hideBlackHoleOverlay();

    clearPerNodeOverrides();

    anim.mode = m;
    writePref(PREF.mode, anim.mode);

    if (anim.mode === "off") {
      stop();
      writePref(PREF.running, "0");
    } else {
      cacheBasePositions(window.cy);
      anim.parentMapInfo = null;
      if (anim.mode === "blackhole") ensureBlackHoleOverlay();
    }
    syncUi();
  };

  window.setAnimIntensity = (v) => { anim.intensity = Math.max(0, parseFloat(v ?? "0")); writePref(PREF.intensity, anim.intensity); syncUi(); };
  window.setAnimSpeed = (v) => { anim.speed = Math.max(0.05, parseFloat(v ?? "1")); writePref(PREF.speed, anim.speed); syncUi(); };

  window.setAnimScope = (scope) => {
    anim.scope = (scope === "selection") ? "selection" : "all";
    writePref(PREF.scope, anim.scope);
    cacheBasePositions(window.cy);
    anim.parentMapInfo = null;
    syncUi();
  };

  window.setAnimRespectLayout = (checked) => { anim.respectLayout = !!checked; writePref(PREF.respect, anim.respectLayout ? "1" : "0"); syncUi(); };

  window.toggleAnimRunning = () => {
    if (anim.mode === "off") window.setAnimMode("bounce");
    if (anim.running) { stop(); writePref(PREF.running, "0"); }
    else { start(); writePref(PREF.running, "1"); }
    syncUi();
  };

  window.resetAnimPrefs = () => {
    Object.keys(localStorage).filter(k => k.startsWith("onexus.anim.")).forEach(k => delPref(k));
    stop();
    anim.mode = "off";
    anim.intensity = 12;
    anim.speed = 1.0;
    anim.scope = "all";
    anim.respectLayout = true;
    anim.parentMapInfo = null;

    cacheBasePositions(window.cy);

    writePref(PREF.mode, "off");
    writePref(PREF.running, "0");
    syncUi();
  };

  // Edgeflow controls
  window.setEdgeFlowDimension = (dimOrNull) => { anim.edgeFlow.dimension = dimOrNull || null; };
  window.setEdgeFlowPattern = (a = 10, b = 6) => { anim.edgeFlow.pattern = [a, b]; };

  // Phase reveal playback (kept)
  window.playPhaseReveal = async function playPhaseReveal({ order = [], perPhaseMs = 700, includeNodes = true } = {}) {
    const cy = window.cy; if (!cy) return;
    cy.edges().style("display", "none");
    if (includeNodes) cy.nodes().style("display", "none");

    const uniq = (arr) => [...new Set(arr)];
    const phases = order.length ? order : uniq(cy.edges().map(e => (e.data("phase") ?? [])).flat());

    for (const ph of phases) {
      const batch = cy.edges().filter(e => (e.data("phase") ?? []).some(x => String(x) === String(ph)));
      batch.style("display", "element");
      if (includeNodes) batch.connectedNodes().style("display", "element");
      window.buildRelationshipLegend?.();
      window.updateMetrics?.();
      await new Promise(r => setTimeout(r, Math.max(100, perPhaseMs)));
    }
  };

  window.stopPhaseReveal = function stopPhaseReveal() {
    const cy = window.cy; if (!cy) return;
    cy.edges().style("display", "element");
    cy.nodes().style("display", "element");
    window.buildRelationshipLegend?.();
    window.updateMetrics?.();
  };

  // ---------- boot ----------
  function migrateAnimPrefs() {
    const raw = readPref(PREF.mode, "off");
    const sane = sanitizeMode(raw);
    if (sane !== raw) writePref(PREF.mode, sane);
  }

  document.addEventListener("DOMContentLoaded", () => {
    migrateAnimPrefs();

    // Force default OFF on boot (ignore persisted running)
    anim.mode = "off";
    writePref(PREF.mode, "off");
    writePref(PREF.running, "0");

    // Load tunables but keep animation stopped
    anim.intensity = parseFloat(readPref(PREF.intensity, String(anim.intensity)));
    anim.speed = parseFloat(readPref(PREF.speed, String(anim.speed)));
    anim.scope = readPref(PREF.scope, "all");
    anim.respectLayout = readPref(PREF.respect, "1") !== "0";

    setTimeout(() => {
      if (isCyReady()) cacheBasePositions(window.cy);
      hideBlackHoleOverlay();
      clearEdgeOverrides();
      syncUi();
    }, 80);
  });
})();