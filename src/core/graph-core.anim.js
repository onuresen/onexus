/* ONEXUS – Fun Animation Lab (robust modes + cache migration)
   Exposes: window.setAnimMode, window.setAnimIntensity, window.setAnimSpeed,
   window.setAnimScope, window.setAnimRespectLayout, window.toggleAnimRunning,
   window.resetAnimPrefs
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

  const ALLOWED_MODES = new Set(['off', 'bounce', 'orbit', 'blackhole', 'breath']);
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
    mode: 'off',           // 'off' | 'bounce' | 'orbit' | 'blackhole' | 'breath'
    intensity: 12,         // default bumped for better visibility
    speed: 1.0,
    scope: 'all',          // 'all' | 'selection'
    respectLayout: true,
    basePos: new Map(),
    raf: null,
    t0: 0,
    last: 0,
    maxFps: 60,
  };

  // ---- utils ---------------------------------------------------------------
  function sanitizeMode(m) {
    if (!m) return 'off';
    const lower = String(m).toLowerCase();
    const migrated = LEGACY_MODE_MAP[lower] ?? lower;
    return ALLOWED_MODES.has(migrated) ? migrated : 'off';
  }

  function migrateAnimPrefs() {
    // Map legacy mode names -> modern; drop invalid values
    const raw = readPref(PREF.mode, 'off');
    const sane = sanitizeMode(raw);
    if (sane !== raw) writePref(PREF.mode, sane);
  }

  function resetAnimPrefs() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('onexus.anim.'))
      .forEach((k) => delPref(k));
    stop();
    anim.mode = 'off';
    anim.intensity = 12;
    anim.speed = 1.0;
    anim.scope = 'all';
    anim.respectLayout = true;
    cacheBasePositions(window.cy);
    syncUi();
  }

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
  }

  function getGraphCenter(cy) {
    const bb = cy.elements(':visible').boundingBox();
    return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }

  function getTargetNodes(cy) {
    // Only visible nodes; if scope=selection, expand to 1-hop neighborhood
    if (anim.scope !== 'selection') return cy.nodes(':visible');
    const sel = cy.$('node:selected');
    if (sel && sel.length > 0) {
      const hood = sel.closedNeighborhood().nodes(':visible');
      return hood.length > 0 ? hood : sel;
    }
    return cy.nodes(':visible');
  }

  function cacheBasePositions(cy) {
    if (!cy) return;
    anim.basePos.clear();
    cy.nodes(':visible').forEach((n) => {
      const p = n.position();
      anim.basePos.set(n.id(), { x: p.x, y: p.y });
    });
  }

  function restoreBasePositions(cy) {
    if (!cy) return;
    cy.nodes().positions((n) => anim.basePos.get(n.id()) ?? n.position());
  }

  const isCyReady = () => !!window.cy && typeof window.cy.nodes === 'function';

  // ---- modes ---------------------------------------------------------------
  function applyBounce(cy, t) {
    const nodes = getTargetNodes(cy);
    const amp = Math.max(0, anim.intensity) * 1.6;      // +visibility
    const freq = 1.2 * anim.speed;
    const omega = 2 * Math.PI * freq;
    const sel = cy.$('node:selected')[0];
    const src = sel ? sel.position() : getGraphCenter(cy);
    nodes.forEach((n) => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      const dx = base.x - src.x;
      const dy = base.y - src.y;
      const r = Math.hypot(dx, dy);
      const phase = r * 0.015;
      const seed = hash01(n.id());
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
    const s = 1 + (Math.sin(t * 1.2 * anim.speed) * (anim.intensity / 80)); // was /200
    nodes.forEach((n) => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      n.position({
        x: center.x + (base.x - center.x) * s,
        y: center.y + (base.y - center.y) * s,
      });
    });
  }

  function applyOrbit(cy, t) {
    const nodes = getTargetNodes(cy);
    const speed = 1.4 * anim.speed;
    const spacing = 34 + anim.intensity * 0.8;
    const sel = cy.$('node:selected')[0];
    const sun = sel ?? nodes[0] ?? cy.nodes()[0];
    if (!sun) return;
    const sunBase = anim.basePos.get(sun.id()) ?? sun.position();
    sun.position({ x: sunBase.x, y: sunBase.y });

    const neighbors = sun.neighborhood('node').filter(':visible');
    neighbors.forEach((n, i) => {
      const ring = i % 8;
      const r = spacing + ring * 10;
      const ang = t * speed + i * 0.6;
      n.position({ x: sunBase.x + r * Math.cos(ang), y: sunBase.y + r * Math.sin(ang) });
    });

    nodes.difference(neighbors).difference(sun).forEach((n) => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      const seed = hash01(n.id());
      const a = (anim.intensity * 0.35) * (0.4 + 0.6 * seed);   // +visibility
      n.position({
        x: base.x + a * Math.sin(t * 1.1 + seed * 6),
        y: base.y + a * Math.cos(t * 1.0 + seed * 5),
      });
    });
  }

  function applyBlackHole(cy, t) {
    const nodes = getTargetNodes(cy);
    const strength = 1.2 * anim.speed;    // +visibility
    const swirl = 0.85 * anim.speed;      // +visibility
    const minR = 36;
    const sel = cy.$('node:selected')[0];
    const hole = sel ? sel.position() : getGraphCenter(cy);
    nodes.forEach((n) => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      const dx = base.x - hole.x;
      const dy = base.y - hole.y;
      let r = Math.hypot(dx, dy);
      r = Math.max(r, minR);
      const pull = (strength * anim.intensity) * (1 / (r * 0.02));
      const nx = dx / r, ny = dy / r;
      const sx = -ny, sy = nx;
      const seed = hash01(n.id());
      const wob = 0.65 + 0.35 * Math.sin(t * 2.0 + seed * 6);
      n.position({
        x: base.x - nx * pull * 8 * wob + sx * swirl * (anim.intensity * 0.22) * Math.sin(t * 1.3),
        y: base.y - ny * pull * 8 * wob + sy * swirl * (anim.intensity * 0.22) * Math.sin(t * 1.3),
      });
    });
  }

  function applyFrame(cy, t) {
    switch (anim.mode) {
      case 'bounce': return applyBounce(cy, t);
      case 'orbit': return applyOrbit(cy, t);
      case 'blackhole': return applyBlackHole(cy, t);
      case 'breath': return applyBreath(cy, t);
      default: return;
    }
  }

  // ---- loop ---------------------------------------------------------------
  function tick(now) {
    if (!anim.running) return;
    const cy = window.cy;
    if (!cy) return;
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
    anim.running = true;
    anim.t0 = performance.now();
    anim.last = 0;
    cacheBasePositions(window.cy);
    if (!window.__onexus_anim_layout_hooked) {
      window.__onexus_anim_layout_hooked = true;
      window.cy.on('layoutstop', () => {
        if (anim.running && anim.respectLayout) cacheBasePositions(window.cy);
      });
    }
    writePref(PREF.running, '1');
    anim.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!isCyReady()) return;
    anim.running = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = null;
    restoreBasePositions(window.cy);
    writePref(PREF.running, '0');
  }

  // ---- UI sync ------------------------------------------------------------
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

  // ---- API ----------------------------------------------------------------
  window.setAnimMode = (mode) => {
    const m = sanitizeMode(mode);
    anim.mode = m;
    writePref(PREF.mode, anim.mode);
    if (anim.mode === 'off') {
      stop();
    } else {
      // refresh base positions whenever switching modes
      cacheBasePositions(window.cy);
      if (anim.running) {
        // continue running; no restart to avoid flicker
      } else {
        start();
      }
    }
    syncUi();
  };

  window.setAnimIntensity = (v) => {
    anim.intensity = Math.max(0, parseFloat(v ?? '0'));
    writePref(PREF.intensity, anim.intensity);
    syncUi();
  };

  window.setAnimSpeed = (v) => {
    anim.speed = Math.max(0.1, parseFloat(v ?? '1'));
    writePref(PREF.speed, anim.speed);
    syncUi();
  };

  window.setAnimScope = (scope) => {
    anim.scope = (scope === 'selection') ? 'selection' : 'all';
    writePref(PREF.scope, anim.scope);
    // recache because visible subset may change after user operations
    cacheBasePositions(window.cy);
    syncUi();
  };

  window.setAnimRespectLayout = (checked) => {
    anim.respectLayout = !!checked;
    writePref(PREF.respect, anim.respectLayout ? '1' : '0');
    syncUi();
  };

  window.toggleAnimRunning = () => {
    if (anim.mode === 'off') {
      window.setAnimMode('bounce'); // default when toggling from off
      return;
    }
    if (anim.running) stop(); else start();
    syncUi();
  };

  window.resetAnimPrefs = resetAnimPrefs;

  // ---- boot ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    migrateAnimPrefs(); // maps legacy values (e.g., 'solar'->'orbit')
    // load prefs (with sanitization)
    anim.mode = sanitizeMode(readPref(PREF.mode, 'off'));
    anim.intensity = parseFloat(readPref(PREF.intensity, String(anim.intensity)));
    anim.speed = parseFloat(readPref(PREF.speed, String(anim.speed)));
    anim.scope = readPref(PREF.scope, 'all');
    anim.respectLayout = readPref(PREF.respect, '1') !== '0';

    // if stored mode is invalid, force to off and persist
    if (!ALLOWED_MODES.has(anim.mode)) {
      anim.mode = 'off';
      writePref(PREF.mode, anim.mode);
      writePref(PREF.running, '0');
    }

    // sync UI early
    syncUi();

    // optionally auto-run if persisted
    const shouldRun = readPref(PREF.running, '0') === '1' && anim.mode !== 'off';
    // slight delay to ensure cy is constructed (core.state boots Cytoscape)
    setTimeout(() => {
      cacheBasePositions(window.cy);
      if (shouldRun) start();
      syncUi();
    }, 80);
  });
})();