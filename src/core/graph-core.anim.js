
// ===============================
// ONEXUS – Fun Animation Lab (playful node motion)
// Exposes: window.setAnimMode, window.setAnimIntensity, window.setAnimSpeed,
//          window.setAnimScope, window.setAnimRespectLayout, window.toggleAnimRunning
// ===============================
(function () {
  const PREF = {
    mode: 'onexus.anim.mode',
    intensity: 'onexus.anim.intensity',
    speed: 'onexus.anim.speed',
    scope: 'onexus.anim.scope',
    respect: 'onexus.anim.respectLayout',
    running: 'onexus.anim.running',
  };
  const readPref = (k, d) => localStorage.getItem(k) ?? d;
  const writePref = (k, v) => localStorage.setItem(k, String(v));

  const anim = {
    running: false,
    mode: 'off',          // off | bounce | orbit | blackhole | breath
    intensity: 10,
    speed: 1.0,
    scope: 'all',         // all | selection
    respectLayout: true,
    basePos: new Map(),
    raf: null,
    t0: 0,
    last: 0,
    maxFps: 60,
  };

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
  }
  function getGraphCenter(cy) {
    const bb = cy.elements().boundingBox();
    return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }
  function getTargetNodes(cy) {
    if (anim.scope !== 'selection') return cy.nodes();
    const sel = cy.$('node:selected');
    if (sel && sel.length > 0) {
      const hood = sel.closedNeighborhood().nodes();
      return hood.length > 0 ? hood : sel;
    }
    return cy.nodes();
  }
  function cacheBasePositions(cy) {
    anim.basePos.clear();
    cy.nodes().forEach(n => {
      const p = n.position();
      anim.basePos.set(n.id(), { x: p.x, y: p.y });
    });
  }
  function restoreBasePositions(cy) {
    cy.nodes().positions(n => anim.basePos.get(n.id()) || n.position());
  }
  function isCyReady() {
    return !!window.cy && typeof window.cy.nodes === 'function';
  }

  function applyBounce(cy, t) {
    const nodes = getTargetNodes(cy);
    const amp = Math.max(0, anim.intensity);
    const freq = 1.2 * anim.speed;
    const omega = 2 * Math.PI * freq;

    const sel = cy.$('node:selected')[0];
    const src = sel ? sel.position() : getGraphCenter(cy);

    nodes.forEach(n => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      const dx = base.x - src.x;
      const dy = base.y - src.y;
      const r = Math.sqrt(dx * dx + dy * dy);
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
    const s = 1 + (Math.sin(t * 1.2 * anim.speed) * (anim.intensity / 200));
    nodes.forEach(n => {
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
    const sun = sel || nodes[0] || cy.nodes()[0];
    if (!sun) return;

    const sunBase = anim.basePos.get(sun.id()) || sun.position();
    sun.position({ x: sunBase.x, y: sunBase.y });

    const neighbors = sun.neighborhood('node');
    neighbors.forEach((n, i) => {
      const ring = i % 8;
      const r = spacing + ring * 10;
      const ang = t * speed + i * 0.6;
      n.position({ x: sunBase.x + r * Math.cos(ang), y: sunBase.y + r * Math.sin(ang) });
    });

    nodes.difference(neighbors).difference(sun).forEach(n => {
      const base = anim.basePos.get(n.id());
      if (!base) return;
      const seed = hash01(n.id());
      const a = (anim.intensity * 0.25) * (0.4 + 0.6 * seed);
      n.position({ x: base.x + a * Math.sin(t * 1.1 + seed * 6), y: base.y + a * Math.cos(t * 1.0 + seed * 5) });
    });
  }

  function applyBlackHole(cy, t) {
    const nodes = getTargetNodes(cy);
    const strength = 0.8 * anim.speed;
    const swirl = 0.6 * anim.speed;
    const minR = 44;

    const sel = cy.$('node:selected')[0];
    const hole = sel ? sel.position() : getGraphCenter(cy);

    nodes.forEach(n => {
      const base = anim.basePos.get(n.id());
      if (!base) return;

      const dx = base.x - hole.x;
      const dy = base.y - hole.y;
      let r = Math.sqrt(dx * dx + dy * dy);
      r = Math.max(r, minR);

      const pull = (strength * anim.intensity) * (1 / (r * 0.02));
      const nx = dx / r;
      const ny = dy / r;

      const sx = -ny, sy = nx;

      const seed = hash01(n.id());
      const wob = 0.65 + 0.35 * Math.sin(t * 2.0 + seed * 6);

      n.position({
        x: base.x - nx * pull * 8 * wob + sx * swirl * (anim.intensity * 0.20) * Math.sin(t * 1.4),
        y: base.y - ny * pull * 8 * wob + sy * swirl * (anim.intensity * 0.20) * Math.sin(t * 1.4),
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
    if (!isCyReady() || anim.running) return;
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

  function syncUi() {
    const $mode = document.getElementById('animMode');
    const $int = document.getElementById('animIntensity');
    const $spd = document.getElementById('animSpeed');
    const $scope = document.getElementById('animScope');
    const $respect = document.getElementById('animRespectLayout');
    const $badge = document.getElementById('animStatus');

    if ($mode) $mode.value = anim.mode;
    if ($int) $int.value = String(anim.intensity);
    if ($spd) $spd.value = String(anim.speed);
    if ($scope) $scope.value = anim.scope;
    if ($respect) $respect.checked = !!anim.respectLayout;
    if ($badge) $badge.textContent = anim.running ? 'Running' : 'Stopped';
  }

  window.setAnimMode = (mode) => {
    anim.mode = mode || 'off';
    writePref(PREF.mode, anim.mode);
    if (anim.mode === 'off') stop(); else start();
    syncUi();
  };
  window.setAnimIntensity = (v) => {
    anim.intensity = Math.max(0, parseFloat(v || '0'));
    writePref(PREF.intensity, anim.intensity);
    syncUi();
  };
  window.setAnimSpeed = (v) => {
    anim.speed = Math.max(0.1, parseFloat(v || '1'));
    writePref(PREF.speed, anim.speed);
    syncUi();
  };
  window.setAnimScope = (scope) => {
    anim.scope = (scope === 'selection') ? 'selection' : 'all';
    writePref(PREF.scope, anim.scope);
    syncUi();
  };
  window.setAnimRespectLayout = (checked) => {
    anim.respectLayout = !!checked;
    writePref(PREF.respect, anim.respectLayout ? '1' : '0');
    syncUi();
  };
  window.toggleAnimRunning = () => {
    if (anim.mode === 'off') { window.setAnimMode('bounce'); return; }
    if (anim.running) stop(); else start();
    syncUi();
  };

  window.ONEXUS_ANIM = anim;

  document.addEventListener('DOMContentLoaded', () => {
    anim.mode = readPref(PREF.mode, 'off');
    anim.intensity = parseFloat(readPref(PREF.intensity, '10'));
    anim.speed = parseFloat(readPref(PREF.speed, '1.0'));
    anim.scope = readPref(PREF.scope, 'all');
    anim.respectLayout = readPref(PREF.respect, '1') !== '0';
    const shouldRun = readPref(PREF.running, '0') === '1' && anim.mode !== 'off';
    setTimeout(() => {
      syncUi();
      if (shouldRun) start();
    }, 50);
  });
})();