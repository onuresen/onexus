/* =============================================================================
   ONEXUS — Enterprise / deployment configuration (deployment-owned policy)

   This file is STATIC POLICY set by whoever deploys ONEXUS. It is loaded before
   any plugin and is the single administrative control point for optional
   features that can leave the local boundary. It is deliberately NOT importable
   through the app UI, localStorage, or a graph file — a user preference must
   never be able to re-enable something a deployment turned off.

   Edit the values below, then serve the file. See docs/DEPLOYMENT.md.
   ============================================================================= */
(function () {
  "use strict";

  window.ONEXUS_ENTERPRISE = Object.freeze({
    /* --- Optional AI ("What-if?" narration, src/plugins/onexus-ai.plugin.js) ---
       When enabled, a user who supplies their OWN Anthropic API key can send a
       graph-impact summary to https://api.anthropic.com for narration. ONEXUS
       calls the HTTP API directly (no SDK, no CDN). The user's key is stored in
       their own browser (localStorage) and sent only to Anthropic.

       enabled:false is a hard, fail-closed kill switch: the 🔮 button is not
       rendered, key storage/read is refused, and no request can be made — this
       is independent of whether a key happens to be present. To also tighten the
       enforced boundary, remove https://api.anthropic.com from the CSP
       connect-src in index.html when AI is disabled. */
    ai: Object.freeze({
      enabled: true,
      // Override only to point at an organization-hosted, API-compatible
      // endpoint. Must also be added to the CSP connect-src if changed.
      endpoint: "https://api.anthropic.com/v1/messages",
      apiVersion: "2023-06-01",
      model: "claude-haiku-4-5",
    }),
  });

  // Convenience accessor used by plugins; treats a malformed/absent config as
  // "feature off" (fail closed).
  window.ONEXUS_ENTERPRISE_AI_ENABLED = function () {
    try {
      return window.ONEXUS_ENTERPRISE.ai.enabled === true;
    } catch {
      return false;
    }
  };
})();
