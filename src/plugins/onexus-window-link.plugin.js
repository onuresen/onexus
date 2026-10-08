/* ONEXUS Window Link Plugin
   A live link with the app that opened this window (for example Object-Centric Drawing).
   No server and no network: messages travel between the two browser windows only.

   It reuses the Revit host message vocabulary (graph-core.io.host.js):
     in   { type: "objdraw-hello" }                 -> replies { type: "onexus-ready" }
     in   { type: "onexus-graph", graph }           -> loads the graph
     in   { type: "highlight-nodes", ids, fitView } -> highlights and fits those nodes
     out  { type: "select-node", id }               -> when a node is tapped here

   Only the opener window is heard, and only from an origin allowed by
   ONEXUS_ENTERPRISE.windowLink (deployment-owned, fail-closed). Replies go to
   that exact origin, never "*".
*/
(function () {
  const ONEXUS = window.ONEXUS;
  if (!ONEXUS || typeof ONEXUS.registerPlugin !== "function") return;

  function policy() {
    try {
      const link = window.ONEXUS_ENTERPRISE?.windowLink;
      return link?.enabled === true ? link : null;
    } catch {
      return null;
    }
  }

  const MAX_FOCUS_ZOOM = 1.4;

  // "http://localhost:*" allows any port on that host; anything else must match exactly.
  function originAllowed(origin, allowed) {
    return (allowed ?? []).some((pattern) => {
      if (pattern === origin) return true;
      if (!pattern.endsWith(":*")) return false;
      const base = pattern.slice(0, -2);
      return origin === base || (origin.startsWith(`${base}:`) && /^\d+$/.test(origin.slice(base.length + 1)));
    });
  }

  ONEXUS.registerPlugin({
    id: "onexus-window-link",
    name: "ONEXUS Window Link",
    version: "1.0.0",

    register() {
      const link = policy();
      if (!link || !window.opener) return;

      let partnerOrigin = null;
      const send = (message) => {
        if (!partnerOrigin || window.opener?.closed) return;
        try {
          window.opener.postMessage(message, partnerOrigin);
        } catch { /* the opener went away — safe fail */ }
      };

      window.addEventListener("message", (event) => {
        if (event.source !== window.opener) return;
        if (!originAllowed(event.origin, link.allowedOrigins)) return;
        const data = event.data;
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;

        if (data.type === "objdraw-hello") {
          partnerOrigin = event.origin;
          send({ type: "onexus-ready" });
          return;
        }
        if (event.origin !== partnerOrigin) return;

        if (data.type === "onexus-graph" && data.graph && typeof data.graph === "object") {
          window.onexusLoadGraph?.(data.graph);
          return;
        }
        if (data.type === "highlight-nodes" && Array.isArray(data.ids) && window.cy) {
          const ids = new Set(data.ids.map(String));
          const cy = window.cy;
          cy.nodes().removeClass("highlight");
          if (ids.size === 0) return;
          const hits = cy.nodes().filter((node) => ids.has(node.id()));
          hits.addClass("highlight");
          if (data.fitView !== false && hits.nonempty()) {
            // Fit, but never zoom in so far that one node fills the canvas.
            cy.animate({
              fit: { eles: hits.closedNeighborhood(), padding: 80 },
              duration: 300,
              complete: () => {
                if (cy.zoom() > MAX_FOCUS_ZOOM) {
                  cy.animate({ zoom: MAX_FOCUS_ZOOM, center: { eles: hits }, duration: 150 });
                }
              },
            });
          }
        }
      });

      ONEXUS.bus?.on?.("nodeSelected", (detail) => {
        if (detail?.id) send({ type: "select-node", id: String(detail.id) });
      });
    },
  });
})();
