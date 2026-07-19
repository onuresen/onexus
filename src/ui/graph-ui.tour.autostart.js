/* ONEXUS – Tutorial Auto-Start
 * Starts the guided tour the first time a graph is loaded (demo or user
 * import), then never again. Leaves the manual toolbar button / "T" hotkey
 * untouched — this only covers the first-run case.
 */
(function () {
  const STORAGE_KEY = "onexus.tourSeen";
  const SETTLE_DELAY_MS = 1000;

  // Skip in CI / headless test mode — matches graph-ui.demoAuto.js's own guard.
  if (new URLSearchParams(window.location.search).get("ci") === "1") return;

  let fired = false;

  function onGraphLoaded(payload) {
    if (fired) return;
    fired = true;

    // Explicit scenario links are handled by the samples loader every time,
    // even for returning visitors who have already seen the first-run tour.
    if (new URLSearchParams(window.location.search).get("scenario")) return;

    // Flagship graphs use the visible story chooser instead of silently
    // launching one story on behalf of the visitor.
    if (payload?.meta?.flagship) return;

    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return; // no localStorage access — don't guess, just skip
    }

    setTimeout(function () {
      try {
        window.ONEXUS_TOUR?.start("basic");
        localStorage.setItem(STORAGE_KEY, "1");
      } catch { /* non-fatal */ }
    }, SETTLE_DELAY_MS);
  }

  document.addEventListener("DOMContentLoaded", function () {
    window.ONEXUS?.bus?.on?.("graphLoaded", onGraphLoaded);
  });
})();
