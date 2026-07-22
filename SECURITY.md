# Security Policy

ONEXUS is a static, no-build browser application (plain HTML + vanilla
JavaScript served from a static host). It has **no application server, no user
accounts, no login, and no cloud persistence** of its own. Understanding that
boundary is the starting point for assessing its risk. This document is written
for an operator or security reviewer; it states what ONEXUS actually does, not an
aspirational posture.

## Supported versions

ONEXUS follows Semantic Versioning from **1.0.0** (see `VERSION` and
`CHANGELOG.md`). This is a single-maintainer project; only the **latest released
minor line** receives security fixes. There is no LTS commitment and no
backport guarantee for older lines — do not assume one.

| Version | Supported |
|---|---|
| Latest released 1.x | ✅ |
| Anything older | ❌ (upgrade) |

## Reporting a vulnerability

Please report privately — **do not open a public issue for a security problem.**

- Preferred: GitHub **Security → "Report a vulnerability"** (private advisory) on
  `onuresen/onexus`.

What to expect (honest commitment, not an SLA): a best-effort acknowledgement
and, for confirmed issues in a supported version, a fix or documented mitigation
in a subsequent release. As a single-maintainer project there is no guaranteed
response time.

Please include affected version/commit, reproduction steps, and impact.

## Architecture & trust boundary

The web app runs entirely in the visitor's browser:

- **No server-side code path** for the web app. Graphs are imported client-side
  and held in memory (`window.cy`); nothing is uploaded by default.
- **A default page load makes no third-party network requests.** All libraries,
  fonts, and the IFC/WASM engine are self-hosted (`src/vendor/`, `assets/fonts/`).
  This is regression-tested (`tests/onexus-egress.spec.js`).
- **Content-Security-Policy** is enforced via a `<meta>` tag in `index.html`
  (`default-src 'self'`; scripts/styles allow `'unsafe-inline'` because the
  no-build architecture uses inline event handlers — this is a documented,
  deliberate weakening, not an oversight; `'wasm-unsafe-eval'` is present so the
  on-demand IFC importer can compile `web-ifc.wasm`).
- Additional protections that a `<meta>` CSP **cannot** deliver
  (`frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy` at the
  transport layer) must be sent as real HTTP headers by the hosting layer — see
  `docs/DEPLOYMENT.md`.

### Optional, deployment-controlled egress

Two destinations can be contacted, and only under explicit conditions:

| Destination | When | Control |
|---|---|---|
| `ws://localhost:8765` | Only if the operator runs the optional MCP server; the browser bridge connects to it. | Local-only; never a public address. |
| `https://api.anthropic.com` | Only if AI is enabled by deployment policy **and** a user supplies their **own** Anthropic API key **and** invokes the "What-if?" narration. | `src/config/onexus-enterprise.config.js` → `ai.enabled` (fail-closed kill switch) **and** the CSP `connect-src`. |

The AI kill switch is independent of whether a key is present: setting
`ai.enabled: false` hides the feature, refuses key storage/read, and makes the
request impossible — a stored user key can never re-enable a disallowed feature.

## Local / shared-device risk

- A user's Anthropic API key (if AI is used) is stored **in plaintext** in that
  browser's `localStorage` under `onexus.ai.v1`. Browser-profile separation is
  **not** authentication: anyone with access to the same OS user / browser
  profile can read it. Do not use ONEXUS with a personal key on a shared,
  unlocked profile. Clear it via browser storage or by disabling AI.
- Imported graph data lives in memory and in any file the user chooses to export.
  ONEXUS does not encrypt exports.

## The optional backend has no authentication (by design)

`onexus-backend/` is an **optional** Express.js graph-storage service for
**local / trusted-network use only**. It has **no authentication by design** and
performs no authorization. Anyone who can reach its port can read and write
stored graphs. **Never expose it to an untrusted network or the public internet
without a reverse proxy that adds TLS and authentication.** It does include
robustness guards (element-count cap, duplicate-id rejection, JSON-only error
responses, oversized-body 413) — those are DoS/robustness measures, not access
control. See `docs/DEPLOYMENT.md`.

## The optional MCP server

`onexus-mcp/` (Python FastMCP + WebSocket on `:8765`) is a **local developer
tool** that lets Claude query a local vault graph file and control the live
browser graph. It binds to `localhost` and is not intended to be exposed
remotely. All server logging goes to stderr (stdout is the MCP transport).

## Dependency posture

Third-party runtime code is **vendored and pinned** under `src/vendor/` (no
runtime CDN). Versions and licenses are inventoried in `THIRD-PARTY-NOTICES.md`.
Development dependencies are pinned via `package-lock.json`. Update vendored
assets deliberately (re-vendor from the pinned npm package), then re-run the
egress and smoke tests.

## Known limitations (explicitly NOT provided)

- **No SSO, no RBAC, no user accounts** — the web app has no identity system.
- **No audit log, no SLA, no LTS.**
- **The optional backend has no auth** (see above).
- **Shared browser-profile separation is not authentication.**
- **Redistribution caveat:** the optional *Export SVG* feature uses a **GPL-3.0**
  component (`cytoscape-svg`). Running ONEXUS is unaffected, but redistributors
  should have legal review decide how to treat that component — see
  `THIRD-PARTY-NOTICES.md`.

## Operator responsibilities

- Serve over HTTPS and add the recommended HTTP headers (`docs/DEPLOYMENT.md`).
- Decide the AI policy (`ai.enabled`) and, if disabling AI, also remove
  `https://api.anthropic.com` from the CSP `connect-src`.
- Keep the optional backend/MCP server off untrusted networks.
- Pin to a reviewed release (tag + checksum) rather than a moving branch.
