/* ONEXUS – Floating Zones
   - Creates top-left zone for minimap
   - Ensures bottom-left zone is used for pill buttons (Layer/Nodes/Tools)
   - Moves #minimap to top-left regardless of earlier scripts
*/
(function () {
    const $ = (id) => document.getElementById(id);

    function ensureHost() {
        const wrap = $("canvas-wrap") || $("cy")?.parentElement;
        if (!wrap) return null;
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        return wrap;
    }

    function ensureTopLeft(host) {
        let tl = $("onx-float-top-left");
        if (tl) return tl;
        tl = document.createElement("div");
        tl.id = "onx-float-top-left";
        Object.assign(tl.style, {
            position: "absolute",
            left: "12px",
            top: "12px",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            pointerEvents: "none",
        });
        host.appendChild(tl);
        return tl;
    }

    function moveMinimapToTopLeft(tl) {
        const mm = $("minimap");
        if (!mm) return;

        if (mm.parentElement !== tl) tl.appendChild(mm);

        // override any bottom-left settings from CSS or other scripts
        mm.style.position = "relative";
        mm.style.left = "auto";
        mm.style.right = "auto";
        mm.style.bottom = "auto";
        mm.style.top = "auto";
        mm.style.margin = "0";
        mm.style.pointerEvents = "auto";
    }

    function boot() {
        const host = ensureHost();
        if (!host) return;
        const tl = ensureTopLeft(host);
        moveMinimapToTopLeft(tl);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
    } else {
        setTimeout(boot, 0);
    }

    // keep it stable if other scripts relocate minimap later
    setInterval(() => {
        const tl = $("onx-float-top-left");
        if (!tl) return;
        const mm = $("minimap");
        if (!mm) return;
        if (mm.parentElement !== tl) moveMinimapToTopLeft(tl);
    }, 800);
})();