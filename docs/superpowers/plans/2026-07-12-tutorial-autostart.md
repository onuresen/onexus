# Tutorial First-Run Auto-Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-start the existing Onexus guided tour (`window.ONEXUS_TOUR.start('basic')`) the first time a user sees a loaded graph, without touching the tour's content or its existing manual button/hotkey.

**Architecture:** A new small script listens once on `window.ONEXUS.bus` for the `"graphLoaded"` event (already emitted both by the demo auto-loader and by real file imports). On first fire, after a settle delay, it starts the tour and sets a `localStorage` flag so it never fires again.

**Tech Stack:** Vanilla JS, no build step. Verify with `npx playwright test` (repo has an existing Playwright suite) plus manual browser check.

## Global Constraints

- No changes to `graph-ui.tour.js`'s tour content, manual button, or `T` hotkey.
- No changes to `graph-ui.demoAuto.js`.
- Must skip entirely when `?ci=1` is in the URL (matches `demoAuto.js`'s own CI guard) so automated/headless test runs never get an unexpected modal.
- Storage key: `onexus.tourSeen` (dotted-key convention, matching the existing `onexus.theme` key read in `graph-core.io.host.js`).

---

### Task 1: Add `graph-ui.tour.autostart.js`

**Files:**
- Create: `E:\GitHub\onexus\src\ui\graph-ui.tour.autostart.js`
- Modify: `E:\GitHub\onexus\index.html:576-577`

**Interfaces:**
- Consumes: `window.ONEXUS.bus.on(eventName, handler)` / `.emit(...)` (already defined — see `src/helpers/onexus-ns.js`, used throughout `src/core/graph-core.io.host.js`); `window.ONEXUS_TOUR.start(name)` (already defined in `src/ui/graph-ui.tour.js`, exposed as `window.ONEXUS_TOUR`).
- Produces: nothing consumed by later tasks — this is the only task in this plan.

- [ ] **Step 1: Write the autostart script**

Create `src/ui/graph-ui.tour.autostart.js`:

```javascript
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

  function onGraphLoaded() {
    if (fired) return;
    fired = true;

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
```

Note the `fired` flag is checked and set *before* the `localStorage` check — this guarantees only one `setTimeout` is ever scheduled per page load even if `graphLoaded` emits multiple times in quick succession (e.g., demo load followed by an immediate real import), which was the double-fire risk called out in the spec.

- [ ] **Step 2: Load the script in `index.html`**

Find:

```html
  <script src=./src/ui/graph-ui.tour.js></script>
  <script src="./src/ui/graph-ui.demoAuto.js"></script>
```

Add the new script right after, so it loads after both the tour engine and the demo loader are defined:

```html
  <script src=./src/ui/graph-ui.tour.js></script>
  <script src="./src/ui/graph-ui.demoAuto.js"></script>
  <script src="./src/ui/graph-ui.tour.autostart.js"></script>
```

- [ ] **Step 3: Manual verification**

```bash
cd "E:/GitHub/onexus"
npx serve .
```

Open the served URL in a browser with devtools open, and first clear any prior flag:

```javascript
localStorage.removeItem('onexus.tourSeen');
location.reload();
```

Expected:
- The demo showcase graph loads (empty-canvas auto-load), and ~1 second later the guided tour overlay appears starting at the "Load a graph" step.
- Reload the page again without clearing storage — expected: no tour auto-starts this time (only the demo graph loads).
- Confirm `localStorage.getItem('onexus.tourSeen')` now returns `"1"`.
- Confirm the manual path still works: press `T` (or click the toolbar tour button) — the tour starts on demand regardless of the stored flag.
- Reload with `?ci=1` appended to the URL after clearing the flag again — expected: no auto-start tour, consistent with `demoAuto.js`'s own CI behavior.

- [ ] **Step 4: Run the existing Playwright suite**

```bash
cd "E:/GitHub/onexus"
npx playwright test
```

Expected: PASS — no existing test should reference the tour or `onexus.tourSeen`, so this is a regression check confirming the new script doesn't break page load, the demo auto-loader, or any other suite.

If any test fails because it now unexpectedly sees the tour overlay (e.g., a test that loads a real file without `?ci=1` and does DOM assertions right after), check whether that test's URL is missing the `?ci=1` param it should already carry per repo convention; add it there rather than weakening the guard in `graph-ui.tour.autostart.js`.

- [ ] **Step 5: Commit**

```bash
cd "E:/GitHub/onexus"
git add src/ui/graph-ui.tour.autostart.js index.html
git commit -m "Auto-start guided tour on first graph load"
```
