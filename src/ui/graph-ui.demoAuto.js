/* ONEXUS – Demo Auto-Loader
 * Loads the showcase sample on an empty canvas so first-time visitors
 * land on a live, animated graph instead of a blank screen.
 *
 * Behaviour:
 *   - Runs only when window.cy has no elements at startup (empty canvas).
 *   - Skipped in CI mode (?ci=1) so automated tests are not affected.
 *   - After load: starts edge-flow animation on the System dimension.
 *   - Any subsequent file import naturally replaces the demo graph.
 */
(function () {
  const DEMO_PATH = "./samples/json/onexus_smart_access_flagship.json";

  // Skip in CI / headless test mode
  const params = new URLSearchParams(window.location.search);
  if (params.get("ci") === "1" || params.get("sample")) return;

  document.addEventListener("DOMContentLoaded", function () {
    // Give all other DOMContentLoaded handlers time to settle (bindings,
    // persistence, samples dropdown, etc.) before we inspect cy.
    setTimeout(async function () {
      try {
        const cy = window.cy;
        if (!cy || cy.elements().length > 0) return; // already has a graph

        const loadFn = window.onexusLoadGraph;
        if (typeof loadFn !== "function") return;

        const graph = await fetch(DEMO_PATH).then(function (r) {
          if (!r.ok) throw new Error("fetch " + r.status);
          return r.json();
        });

        // One-shot listener: activate animations once the graph has settled.
        document.addEventListener("onexus:graphLoaded", function () {
          setTimeout(function () {
            try {
              // Apply a layout that shows system hierarchies clearly.
              window.applyLayout?.("system");
            } catch { /* safe fail */ }

            // Edge flow on System dimension: power/control signals "flow"
            // along the directed edges, showing the live building in motion.
            setTimeout(function () {
              try {
                window.setEdgeFlowDimension?.("System");
                window.setAnimMode?.("edgeflow");
                window.toggleAnimRunning?.(); // anim always boots as stopped
              } catch { /* safe fail */ }
            }, 800); // extra delay so layout has finished settling
          }, 300);
        }, { once: true });

        loadFn(graph);

      } catch (e) {
        // Non-fatal — user just sees an empty canvas as before.
        window.ONEXUS_LOG?.log("[demoAuto] showcase not loaded:", e.message);
      }
    }, 280);
  });
})();
