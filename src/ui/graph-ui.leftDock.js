/* ONEXUS – Left Dock Orchestrator
   - Moves minimap to TOP-LEFT
   - Collects left buttons into BOTTOM-LEFT stack
   - Converts leftRail icon buttons into pill buttons (dot + text)
   Safe: does not remove functionality; only rearranges DOM and styles.
*/
(function () {
    const $ = (id) => document.getElementById(id);

    function ensureHost() {
        const wrap = $("canvas-wrap") ?? $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        return wrap;
    }

    // Ensure a host container exists for bottom-right overlays (minimap)
    function ensureBottomRight(host) {
        let br = $("onx-float-bottom-right");
        if (br) return br;
        br = document.createElement("div");
        br.id = "onx-float-bottom-right";
        Object.assign(br.style, {
            position: "absolute",
            right: "12px",
            bottom: "12px",
            zIndex: 31,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none",
            alignItems: "flex-end",
        });
        host.appendChild(br);
        return br;
    }

    function ensureBottomLeft(host) {
        // reuse existing stack if present (created by common css + layer widget)
        let bot = $("onx-float-left-stack");
        if (bot) {
            bot.style.left = "12px";
            bot.style.bottom = "12px";
            bot.style.zIndex = "30";
            bot.style.pointerEvents = "none";
            bot.style.display = "flex";
            bot.style.flexDirection = "column";
            bot.style.alignItems = "flex-start";
            bot.style.gap = "10px";
            return bot;
        }
        bot = document.createElement("div");
        bot.id = "onx-float-left-stack";
        Object.assign(bot.style, {
            position: "absolute",
            left: "12px",
            bottom: "12px",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            pointerEvents: "none",
        });
        host.appendChild(bot);
        return bot;
    }

    function allowPointer(el) {
        if (!el) return;
        el.style.pointerEvents = "auto";
    }

    function moveMinimapToBottomRight(bottomRightHost) {
        const mm = $("minimap");
        if (!mm) return;
        // ensure minimap is a direct child of the canvas-wrap for absolute positioning
        const container = document.getElementById('canvas-wrap') || bottomRightHost?.parentElement || document.body;
        if (mm.parentElement !== container) container.appendChild(mm);

        // override styles to keep minimap anchored to bottom-right
        Object.assign(mm.style, {
            position: "absolute",
            right: "12px",
            bottom: "12px",
            left: "auto",
            top: "auto",
            margin: "0",
        });

        allowPointer(mm);
        // bottomRightHost stays as a layout anchor but we keep pointer events on minimap
        if (bottomRightHost) bottomRightHost.style.pointerEvents = "none";
        mm.style.pointerEvents = "auto";
    }

    function pillifyLeftRail(bottom) {
        const rail = $("leftRail");
        if (!rail) return;

        // Move leftRail into bottom-left and restyle it as pills
        if (rail.parentElement !== bottom) bottom.insertBefore(rail, bottom.firstChild);

        Object.assign(rail.style, {
            position: "relative",
            left: "auto",
            top: "auto",
            right: "auto",
            bottom: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            zIndex: "30",
            pointerEvents: "auto",
        });

        // Convert each button into dot+text pill
        const map = {
            panelRelationshipIntelligence: { text: "Intelligence", dot: "#7c3aed" },
            panelFilter: { text: "Filter", dot: "#2563eb" },
            panelStyle: { text: "Style", dot: "#f59e0b" },
            panelAnim: { text: "Anim", dot: "#10b981" },
        };

        rail.querySelectorAll(".rail-btn").forEach((btn) => {
            const key = btn.dataset.panel;
            const cfg = map[key] ?? { text: key ?? "Tool", dot: "#64748b" };

            btn.innerHTML = `
        <span style="
          width:12px;height:12px;border-radius:999px;
          background:${cfg.dot};
          box-shadow:0 0 0 3px rgba(0,0,0,0.08);
          display:inline-block;"></span>
        <span style="font-weight:700;font-size:12px;">${cfg.text}</span>
      `;

            Object.assign(btn.style, {
                width: "auto",
                height: "36px",
                padding: "0 12px",
                borderRadius: "999px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255,255,255,0.78)",
                border: "1px solid var(--stroke)",
                boxShadow: "var(--shadow-sm)",
                cursor: "pointer",
                userSelect: "none",
            });

            btn.style.pointerEvents = "auto";
        });
    }

    function collectBottomLeftButtons(bottom) {
        // layer widget button
        allowPointer($("onx-layer-fab"));
        allowPointer($("onx-layer-pop"));

        // node visibility button (if exists)
        allowPointer($("onx-nodevis-fab"));
        allowPointer($("onx-nodevis-pop"));
    }

    function boot() {
        const host = ensureHost();
        if (!host) return;

        const bottomRight = ensureBottomRight(host);
        const bottom = ensureBottomLeft(host);

        // Move minimap to bottom-right (respecting CSS override)
        moveMinimapToBottomRight(bottomRight);

        // Put tool buttons (Filter/Style/Anim) into bottom-left as pills
        pillifyLeftRail(bottom);

        // Keep Layer / Nodes pills bottom-left too
        collectBottomLeftButtons(bottom);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
    else setTimeout(boot, 0);

    // Re-apply after other scripts do DOM moves
    setTimeout(boot, 200);
    setTimeout(boot, 600);
})();
