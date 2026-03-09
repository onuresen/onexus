(function () {
    // Make the floating details inspector draggable within the canvas-wrap
    const float = document.getElementById('onxFloatDetails');
    if (!float) return;

    const handle = float.querySelector('.onx-fd-top') || float;
    if (!handle) return;

    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function getContainerRect() {
        const host = document.getElementById('canvas-wrap');
        return host ? host.getBoundingClientRect() : document.body.getBoundingClientRect();
    }

    function onPointerDown(e) {
        // ignore non-left buttons
        if (e.button !== 0) return;
        // if clicking an interactive control (close button, inputs, etc.), do not start drag
        if (e.target && e.target.closest && e.target.closest('.onx-fd-close, button, a, input, select, textarea')) return;

        dragging = true;
        handle.setPointerCapture?.(e.pointerId);
        startX = e.clientX;
        startY = e.clientY;

        const rect = float.getBoundingClientRect();
        const container = getContainerRect();

        // compute origLeft/Top relative to container
        origLeft = rect.left - container.left;
        origTop = rect.top - container.top;

        // switch to left/top positioning
        float.style.right = 'auto';
        if (!float.style.left) float.style.left = `${origLeft}px`;
        if (!float.style.top) float.style.top = `${origTop}px`;

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const container = getContainerRect();
        const elW = float.offsetWidth;
        const elH = float.offsetHeight;

        let left = origLeft + dx;
        let top = origTop + dy;

        // clamp within container padding
        left = clamp(left, 8, Math.max(8, container.width - elW - 8));
        top = clamp(top, 8, Math.max(8, container.height - elH - 8));

        float.style.left = `${Math.round(left)}px`;
        float.style.top = `${Math.round(top)}px`;
    }

    function onPointerUp(e) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture?.(e.pointerId); } catch { }
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);

        // persist position
        try {
            localStorage.setItem('onx.floatDetails.left', float.style.left || '');
            localStorage.setItem('onx.floatDetails.top', float.style.top || '');
        } catch (err) { }
    }

    // restore saved position
    (function restore() {
        try {
            const l = localStorage.getItem('onx.floatDetails.left');
            const t = localStorage.getItem('onx.floatDetails.top');
            if (l) float.style.left = l;
            if (t) float.style.top = t;
            // ensure right is unset
            float.style.right = float.style.right || 'auto';
        } catch (e) { }
    })();

    // indicate draggable affordance
    try { handle.style.cursor = 'move'; } catch (e) { }
    handle.addEventListener('pointerdown', onPointerDown);
})();
