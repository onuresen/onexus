# Tutorial alignment: first-run auto-trigger

**Date:** 2026-07-12
**Status:** Approved
**Related:** Thinking-Hub repo gets a matching change (gated steps + replay
entry point) — see that repo's own spec under the same date.

## Context

Onexus (`src/ui/graph-ui.tour.js`) and Thinking Hub (`hub-tutorial.js`) both
have interactive tours, but they diverged:

- Thinking Hub auto-triggers its tour for new users (on first visit, and again
  after the first project is created), so most users see it without hunting
  for it.
- Onexus's tour (`window.ONEXUS_TOUR`) is manual-only — a toolbar button and
  the `T` hotkey — so a first-time user who doesn't notice either never sees
  it.

This spec adds a first-run auto-trigger to Onexus, without touching the
existing manual button/hotkey/tour content.

## Auto-trigger

Onexus already has an event bus (`window.ONEXUS.bus`) that emits
`"graphLoaded"` both when the demo showcase auto-loads on an empty canvas
(`graph-ui.demoAuto.js`) and when a user imports their own file
(`graph-core.io.host.js`). This is the right hook: by the time it fires, there
is always a graph on screen for the tour to point at (never a blank canvas).

New file: `src/ui/graph-ui.tour.autostart.js`

- On `window.ONEXUS.bus.on("graphLoaded", ...)`, check
  `localStorage.getItem("onexus.tourSeen")` (dotted-key convention, matching
  `onexus.theme`).
- If unset:
  - Wait ~1s after the event (mirrors `demoAuto.js`'s own settle delay before
    it applies layout/animation, so the tour doesn't fight the demo's
    layout-then-animate sequence).
  - Call `window.ONEXUS_TOUR.start("basic")`.
  - Set `localStorage.setItem("onexus.tourSeen", "1")`.
- If already set, do nothing — this file becomes a no-op after the first run.
- Register the bus listener with a one-shot guard (unsubscribe or an internal
  flag) so it can't double-fire if `graphLoaded` emits more than once in a
  session (e.g., demo load followed immediately by a real import).
- Skip entirely in CI/test mode (`?ci=1` query param), matching
  `demoAuto.js`'s own guard — an unattended test run should not get a modal
  tour popping up mid-test.

Load this script after `graph-ui.tour.js` and `graph-ui.demoAuto.js` in
`index.html` (and `index_leftRail.html` if it separately lists scripts).

## Out of scope

- No changes to the manual toolbar button, `T` hotkey, or the "basic" tour's
  step content.
- No shared/extracted library between Onexus and Thinking Hub — they remain
  independent implementations (per explicit decision).
