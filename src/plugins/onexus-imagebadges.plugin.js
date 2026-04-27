/* =========================================================
 ONEXUS Plugin — Image Badges (canvas overlay)
 - Draws small badge icon/text at node corner:
   node.data.badgeImg (url/data-uri/local relative path) OR node.data.badgeText
 - Minimal impact: does NOT touch Cytoscape stylesheet; renders via canvas overlay
 - Adds Style panel controls:
   - Thumbnails toggle -> ONEXUS.style.setImageNodesEnabled()
   - Badges toggle + Badge scale slider (affects all badges)

 Data fields (node.data):
   badgeImg   : string (url, data-uri, or relative path)
   badgeText  : string (fallback / optional)
   badgeBg    : string CSS color (optional)
   badgeFg    : string CSS color (optional)
   badgeSize  : number px (optional base size per node)

 NOTE:
 - Badge size slider applies a GLOBAL SCALE multiplier to all badges.
========================================================= */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    const LS_BADGES = "onexus.badges.enabled";
    const LS_BADGE_SCALE = "onexus.badges.scale";

    const DEFAULT_ENABLED = true;

    const CFG = {
        enabled: false,
        sizePx: 22,        // default base size (used if node has no badgeSize)
        scale: 1.0,        // global multiplier controlled by UI slider
        paddingPx: 2,
        zIndex: 7,         // above cy canvas; below most UI overlays
        fpsCapMs: 33,      // ~30fps
        showTextFallback: true,
        clipCircle: true
    };

    const cache = new Map(); // url -> { img, ok, err }
    let canvas = null;
    let ctx = null;
    let dpr = 1;

    let raf = 0;
    let lastPaintMs = 0;
    let dirty = true;
    let needsResize = false;

    function isDark() {
        const k = window.getCurrentThemeKey?.() ?? window.currentTheme ?? "light";
        return String(k).toLowerCase() === "dark";
    }

    function isFileProtocol() {
        try { return String(location.protocol).toLowerCase() === "file:"; }
        catch { return false; }
    }

    function readEnabledPref() {
        try {
            const v = localStorage.getItem(LS_BADGES);
            if (v === "0") return false;
            if (v === "1") return true;
            return DEFAULT_ENABLED;
        } catch {
            return DEFAULT_ENABLED;
        }
    }

    function writeEnabledPref(v) {
        try { localStorage.setItem(LS_BADGES, v ? "1" : "0"); } catch { }
    }

    function readScalePref() {
        try {
            const v = parseFloat(localStorage.getItem(LS_BADGE_SCALE) ?? "1");
            return Number.isFinite(v) ? clamp(v, 0.6, 1.6) : 1.0;
        } catch {
            return 1.0;
        }
    }

    function writeScalePref(v) {
        try { localStorage.setItem(LS_BADGE_SCALE, String(v)); } catch { }
    }

    function getCy() {
        const cy = window.cy;
        return (cy && typeof cy.nodes === "function") ? cy : null;
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function ensureCanvas() {
        const cy = getCy();
        if (!cy) return null;
        const host = cy.container?.();
        if (!host) return null;

        if (canvas && canvas.isConnected && ctx) return canvas;

        canvas = document.createElement("canvas");
        canvas.id = "onx-badges-canvas";
        Object.assign(canvas.style, {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            zIndex: String(CFG.zIndex)
        });

        try {
            const cs = getComputedStyle(host);
            if (cs.position === "static") host.style.position = "relative";
        } catch { }

        host.appendChild(canvas);
        ctx = canvas.getContext("2d", { alpha: true });

        resizeCanvas();
        return canvas;
    }

    function resizeCanvas() {
        const cy = getCy();
        if (!cy || !canvas || !ctx) return;

        const host = cy.container();
        const rect = host.getBoundingClientRect();
        dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        canvas.style.width = rect.width + "px";
        canvas.style.height = rect.height + "px";

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dirty = true;
    }

    function clear() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }

    function getCachedImage(url) {
        const u = String(url ?? "").trim();
        if (!u) return null;

        const existing = cache.get(u);
        if (existing) return existing;

        const img = new Image();

        // IMPORTANT for file:// :
        // - Avoid forcing crossOrigin under file protocol (can cause odd failures).
        // - For http(s) you can keep anonymous (best-effort).
        if (!isFileProtocol()) {
            img.crossOrigin = "anonymous";
        }

        const entry = { img, ok: false, err: false };
        cache.set(u, entry);

        img.onload = () => { entry.ok = true; entry.err = false; dirty = true; };
        img.onerror = () => { entry.ok = false; entry.err = true; dirty = true; };

        img.src = u;
        return entry;
    }

    function drawBadgeText(cx, cyy, r, text, fg) {
        const t = String(text ?? "").trim();
        if (!t) return;

        ctx.save();
        ctx.fillStyle = fg;
        ctx.font = `${Math.max(10, Math.floor(r * 0.95))}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.length > 3 ? t.slice(0, 3) : t, cx, cyy);
        ctx.restore();
    }

    function drawBadgeForNode(n) {
        const data = n.data?.() || {};
        const badgeImg = data.badgeImg;
        const badgeText = data.badgeText;
        if (!badgeImg && !badgeText) return;

        const bb = (typeof n.renderedBoundingBox === "function") ? n.renderedBoundingBox() : null;
        if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h) || bb.w <= 0 || bb.h <= 0) return;

        // Base size: node-specific if provided; else global base size
        const baseSize = Number.isFinite(data.badgeSize) ? Number(data.badgeSize) : CFG.sizePx;

        // FINAL size uses global scale multiplier always
        const r = clamp((baseSize * CFG.scale), 10, 30);
        const pad = CFG.paddingPx;

        // top-right
        const cx = bb.x2 - r * 0.55 - pad;
        const cyy = bb.y1 + r * 0.55 + pad;

        const bg = String(data.badgeBg ?? (isDark() ? "rgba(15,17,21,0.80)" : "rgba(255,255,255,0.92)"));
        const stroke = isDark() ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)";
        const fg = String(data.badgeFg ?? (isDark() ? "#E6E9EE" : "#111827"));

        ctx.save();

        // shadow
        ctx.shadowColor = isDark() ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.18)";
        ctx.shadowBlur = 8;

        // circle background
        ctx.beginPath();
        ctx.fillStyle = bg;
        ctx.arc(cx, cyy, r, 0, Math.PI * 2);
        ctx.fill();

        // border
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.arc(cx, cyy, r, 0, Math.PI * 2);
        ctx.stroke();

        // image or text
        if (badgeImg) {
            const entry = getCachedImage(badgeImg);
            if (entry && entry.ok && entry.img) {
                const img = entry.img;
                const inner = r * 0.82;

                if (CFG.clipCircle) {
                    ctx.beginPath();
                    ctx.arc(cx, cyy, inner, 0, Math.PI * 2);
                    ctx.clip();
                }

                // cover-fit into square
                const box = inner * 2;
                const iw = img.naturalWidth || img.width;
                const ih = img.naturalHeight || img.height;

                if (iw > 0 && ih > 0) {
                    const sc = Math.max(box / iw, box / ih);
                    const dw = iw * sc;
                    const dh = ih * sc;
                    const dx = cx - dw / 2;
                    const dy = cyy - dh / 2;
                    ctx.drawImage(img, dx, dy, dw, dh);
                }
            } else if (CFG.showTextFallback && badgeText) {
                drawBadgeText(cx, cyy, r, badgeText, fg);
            }
        } else if (badgeText) {
            drawBadgeText(cx, cyy, r, badgeText, fg);
        }

        ctx.restore();
    }

    function markDirty() { dirty = true; }

    function paint(ms) {
        if (!CFG.enabled) return;

        // throttle
        if (lastPaintMs && (ms - lastPaintMs) < CFG.fpsCapMs) {
            raf = requestAnimationFrame(paint);
            return;
        }
        lastPaintMs = ms;

        const cy = getCy();
        if (!cy) { raf = requestAnimationFrame(paint); return; }

        ensureCanvas();
        if (!canvas || !ctx) { raf = requestAnimationFrame(paint); return; }

        if (needsResize) { needsResize = false; resizeCanvas(); dirty = true; }

        if (dirty) {
            clear();
            cy.nodes(":visible").forEach(n => {
                try { drawBadgeForNode(n); } catch { }
            });
            dirty = false;
        }

        raf = requestAnimationFrame(paint);
    }

    function hookCy() {
        const cy = getCy();
        if (!cy || cy.__onxBadgesHooked) return;
        cy.__onxBadgesHooked = true;

        cy.on("pan zoom", markDirty);
        cy.on("resize", () => { needsResize = true; markDirty(); });
        cy.on("add remove", markDirty);

        // graph load -> redraw
        try { window.ONEXUS?.bus?.on?.("graphLoaded", markDirty); } catch { }
    }

    function hookResize() {
        if (window.__onxBadgesResizeHooked) return;
        window.__onxBadgesResizeHooked = true;

        window.addEventListener("resize", () => {
            if (!CFG.enabled) return;
            needsResize = true;
            markDirty();
        });
    }

    function enable({ persist = true } = {}) {
        if (CFG.enabled) return;
        CFG.enabled = true;
        if (persist) writeEnabledPref(true);

        ensureCanvas();
        markDirty();
        hookCy();
        hookResize();

        raf = requestAnimationFrame(paint);
        window.showTransientMessage?.("Badges: ON", 1200);
    }

    function disable({ persist = true } = {}) {
        if (!CFG.enabled) return;
        CFG.enabled = false;
        if (persist) writeEnabledPref(false);

        if (raf) cancelAnimationFrame(raf);
        raf = 0;

        clear();
        window.showTransientMessage?.("Badges: OFF", 1200);
    }

    function setScale(v) {
        const s = clamp(Number(v ?? 1), 0.6, 1.6);
        CFG.scale = s;
        writeScalePref(s);
        markDirty();
    }

    // -----------------------------
    // UI injection into Style panel
    // -----------------------------
    function ensureUi() {
        const panel =
            document.getElementById("panelStyle") ||
            document.querySelector("#leftDrawer #panelStyle");
        if (!panel) return;
        if (panel.querySelector("#onxBadgesPanel")) return;

        const wrap = document.createElement("div");
        wrap.id = "onxBadgesPanel";
        wrap.style.marginTop = "12px";
        wrap.style.paddingTop = "10px";
        wrap.style.borderTop = "1px solid var(--stroke)";

        wrap.innerHTML = `
      <h3>Images</h3>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-main);user-select:none;">
        <input id="onxThumbToggle" type="checkbox" style="width:14px;height:14px;accent-color:#2563eb;" />
        Thumbnails (node.data.img)
      </label>

      <label style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-main);user-select:none;margin-top:8px;">
        <input id="onxBadgesToggle" type="checkbox" style="width:14px;height:14px;accent-color:#2563eb;" />
        Badges (node.data.badgeImg / badgeText)
      </label>

      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
        <div style="font-size:11px;color:var(--text-muted);min-width:84px;">Badge scale</div>
        <input id="onxBadgeScale" type="range" min="0.6" max="1.6" step="0.05" value="${CFG.scale}" style="flex:1;" />
        <div id="onxBadgeScaleLbl" style="font-size:11px;color:var(--text-muted);min-width:54px;">${Math.round(CFG.scale * 100)}%</div>
      </div>

      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.35;">
        Badge scale affects all badges (including nodes with badgeSize). Badges are overlay-based (no Cytoscape layout impact).
      </div>
    `;
        panel.appendChild(wrap);

        const $thumb = wrap.querySelector("#onxThumbToggle");
        const $badges = wrap.querySelector("#onxBadgesToggle");
        const $scale = wrap.querySelector("#onxBadgeScale");
        const $scaleLbl = wrap.querySelector("#onxBadgeScaleLbl");

        // init state
        $thumb.checked = window.ONEXUS?.style?.isImageNodesEnabled?.() !== false;
        $badges.checked = readEnabledPref() !== false;

        $thumb.addEventListener("change", () => {
            window.ONEXUS?.style?.setImageNodesEnabled?.($thumb.checked);
        });

        $badges.addEventListener("change", () => {
            if ($badges.checked) enable({ persist: true });
            else disable({ persist: true });
        });

        $scale.addEventListener("input", () => {
            const v = parseFloat($scale.value);
            setScale(v);
            $scaleLbl.textContent = `${Math.round(v * 100)}%`;
        });
    }

    function boot() {
        // load persisted scale
        CFG.scale = readScalePref();

        ensureUi();
        setTimeout(ensureUi, 220);
        setTimeout(ensureUi, 650);

        // start based on preference
        if (readEnabledPref()) enable({ persist: false });
        else disable({ persist: false });

        // redraw on theme changes
        try { window.ONEXUS?.bus?.on?.("layerModeChanged", markDirty); } catch { }
    }

    // Expose API (optional debugging)
    window.ONEXUS_BADGES = {
        enable,
        disable,
        toggle: () => (CFG.enabled ? disable({ persist: true }) : enable({ persist: true })),
        setScale,
        isOn: () => !!CFG.enabled,
        getOptions: () => ({ ...CFG })
    };

    // Plugin registration
    ONX.registerPlugin({
        id: "image-badges",
        title: "Image Badges (overlay)",
        register() {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
            } else {
                setTimeout(boot, 0);
            }
        }
    });
})();