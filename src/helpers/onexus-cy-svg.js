/* =============================================================================
   ONEXUS — cy.svg() export (Apache-2.0, part of ONEXUS)

   Registers a `cy.svg(options)` core extension that serializes the current
   Cytoscape graph to an SVG string, so "Export SVG" needs no GPL dependency.

   HOW IT WORKS (independent implementation): Cytoscape's canvas renderer draws
   into any 2D-canvas-like context. We hand it a canvas2svg mock context
   (window.C2S — MIT, vendored at src/vendor/canvas2svg.1.0.16.js), let the
   renderer draw the elements, then serialize. This is canvas2svg's documented
   "mock a 2d context, draw, getSerializedSvg()" pattern applied to Cytoscape's
   public renderer API (renderer(), drawElements, getCachedZSortedEles,
   getPixelRatio, findContainerClientCoords). It intentionally replaces the
   GPL-3.0 cytoscape-svg wrapper; do not reintroduce that dependency.

   Options (compatible with prior usage):
     full        — export the whole graph extent (default false → viewport)
     scale       — output scale multiplier
     maxWidth/maxHeight — cap output size (mutually exclusive with scale)
     bg          — background fill colour (default transparent)
   ============================================================================= */
(function () {
  "use strict";

  function isNum(x) {
    return x != null && typeof x === "number" && !isNaN(x);
  }

  function toSvg(options) {
    options = options || {};
    const cy = this;
    const C2S = window.C2S;
    if (typeof C2S !== "function") {
      throw new Error("SVG export engine (canvas2svg) not loaded.");
    }

    const renderer = cy.renderer();

    // Force non-path rendering so the mock context captures drawn shapes, and
    // clear any cached paths (same requirement the canvas renderer has for a
    // fresh non-path pass). Restored in a finally block.
    const usePathsPrev = renderer.usePaths;
    renderer.usePaths = function () { return false; };
    cy.elements().forEach(function (ele) {
      const rs = ele._private && ele._private.rscratch;
      if (rs) { rs.pathCacheKey = null; rs.pathCache = null; }
    });

    try {
      const bb = cy.mutableElements().boundingBox();
      const container = renderer.findContainerClientCoords();
      let width = options.full ? Math.ceil(bb.w) : container[2];
      let height = options.full ? Math.ceil(bb.h) : container[3];
      const pxr = renderer.getPixelRatio();
      let zoom = 1;

      if (options.scale !== undefined) {
        width *= options.scale;
        height *= options.scale;
        zoom = options.scale;
      } else if (isNum(options.maxWidth) || isNum(options.maxHeight)) {
        let sw = Infinity;
        let sh = Infinity;
        if (isNum(options.maxWidth)) sw = (zoom * options.maxWidth) / width;
        if (isNum(options.maxHeight)) sh = (zoom * options.maxHeight) / height;
        zoom = Math.min(sw, sh);
        width *= zoom;
        height *= zoom;
      } else {
        width *= pxr;
        height *= pxr;
        zoom *= pxr;
      }

      const ctx = new C2S(width, height);

      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);
        if (options.bg) {
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = options.bg;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.globalCompositeOperation = "source-over";

        const eles = renderer.getCachedZSortedEles();
        if (options.full) {
          ctx.translate(-bb.x1 * zoom, -bb.y1 * zoom);
          ctx.scale(zoom, zoom);
          renderer.drawElements(ctx, eles);
          ctx.scale(1 / zoom, 1 / zoom);
          ctx.translate(bb.x1 * zoom, bb.y1 * zoom);
        } else {
          const pan = cy.pan();
          const p = { x: pan.x * zoom, y: pan.y * zoom };
          zoom *= cy.zoom();
          ctx.translate(p.x, p.y);
          ctx.scale(zoom, zoom);
          renderer.drawElements(ctx, eles);
          ctx.scale(1 / zoom, 1 / zoom);
          ctx.translate(-p.x, -p.y);
        }
      }

      return ctx.getSerializedSvg();
    } finally {
      renderer.usePaths = usePathsPrev;
    }
  }

  function register(cytoscape) {
    if (!cytoscape) return;
    cytoscape("core", "svg", toSvg);
  }

  if (typeof window !== "undefined" && window.cytoscape) {
    register(window.cytoscape);
  } else if (typeof cytoscape !== "undefined") {
    register(cytoscape);
  }
})();
