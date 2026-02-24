/* ONEXUS – Popover Positioner (shared)
   - Positions popovers to the RIGHT of the bottom-left stack/pills
   - Supports bottom-alignment to STACK bottom (consistent UI)
   - Avoids minimap overlap by clamping top >= minimap.bottom + padding
   - Clamps within viewport
*/
(function () {
    const PAD = 12;

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function getRect(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!Number.isFinite(r.width) || r.width <= 0 || r.height <= 0) return null;
        return r;
    }

    function getMinimapRect() {
        const mm = document.getElementById("minimap");
        return getRect(mm);
    }

    /**
     * Position a popover next to an anchor or a stack.
     * @param {HTMLElement} pop
     * @param {{
     *   anchorEl?: HTMLElement,
     *   stackEl?: HTMLElement,
     *   mode?: 'stackBottom' | 'anchorBottom',
     *   preferRight?: boolean,
     *   avoidMinimap?: boolean
     * }} opts
     */
    function positionPopover(pop, opts = {}) {
        if (!pop) return;

        const anchorEl = opts.anchorEl || null;
        const stackEl = opts.stackEl || null;
        const mode = opts.mode || "stackBottom"; // default to stack-bottom for consistency
        const preferRight = opts.preferRight !== false;
        const avoidMinimap = opts.avoidMinimap !== false;

        const a = getRect(anchorEl);
        const s = getRect(stackEl);
        if (!a && !s) return;

        // Make measurable
        pop.style.position = "fixed";
        pop.style.visibility = "hidden";
        pop.style.display = "block";

        const p = pop.getBoundingClientRect();
        const mm = avoidMinimap ? getMinimapRect() : null;

        // Horizontal: prefer right side of anchor/stack
        const baseRight = (a ? a.right : s.right);
        const baseLeft = (a ? a.left : s.left);

        let left = preferRight ? (baseRight + 10) : (baseLeft - p.width - 10);

        // Flip if overflow right
        if (left + p.width > window.innerWidth - PAD) {
            left = baseLeft - p.width - 10;
        }
        // Clamp
        left = clamp(left, PAD, window.innerWidth - p.width - PAD);

        // Vertical: bottom-align to stack bottom (recommended)
        const bottomRef = (mode === "anchorBottom" && a) ? a.bottom : (s ? s.bottom : a.bottom);
        let top = bottomRef - p.height;

        // Avoid minimap overlap (top must be >= minimap.bottom + PAD)
        if (mm) {
            const minTop = mm.bottom + PAD;
            if (top < minTop) top = minTop;
        }

        // Clamp within viewport
        top = clamp(top, PAD, window.innerHeight - p.height - PAD);

        // Apply
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        pop.style.visibility = "visible";
    }

    window.ONEXUS = window.ONEXUS || {};
    window.ONEXUS.ui = window.ONEXUS.ui || {};
    window.ONEXUS.ui.positionPopover = positionPopover;
})();