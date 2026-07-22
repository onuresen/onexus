# Changelog

All notable changes to ONEXUS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and ONEXUS adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The canonical version
lives in `VERSION`; a release tag must match it (see `docs/RELEASING.md`).

## [Unreleased]

## [1.0.0] - 2026-07-22

First release governed by the formal versioning, security, and release contract.
The application was already feature-complete ("shipped-v1"); this release makes
it **reviewable and deployable inside an enterprise** without changing its
serverless, no-build nature.

### Added
- Apache-2.0 `LICENSE`, `NOTICE`, and a complete `THIRD-PARTY-NOTICES.md`
  inventory (versions + licenses) for every bundled, optional-runtime,
  development, and companion-service dependency.
- Reviewer/operator package: `SECURITY.md` (supported versions, private
  vulnerability reporting, trust boundary, known limitations), `PRIVACY.md`
  (data map + full egress table), and `docs/DEPLOYMENT.md` (topology, HTTP
  headers, feature policy, backup/rollback, incident response, offboarding).
- Deployment-owned feature policy `src/config/onexus-enterprise.config.js` with a
  fail-closed AI kill switch (`ai.enabled`) that is independent of whether a user
  key is present.
- Enforced `Content-Security-Policy` (`<meta>`) and `Referrer-Policy` in
  `index.html`.
- Network-egress regression test (`tests/onexus-egress.spec.js`) proving a
  default page load makes zero third-party requests, libraries/fonts are
  same-origin, and a CSP is present.
- Release provenance: `VERSION`, this `CHANGELOG.md`, `docs/RELEASING.md`, and a
  tag-triggered release workflow that validates version/changelog/ancestry,
  reruns lint + smoke, emits a SHA-256 checksum, and publishes an immutable
  archive.
- A "Enterprise & security review" front door in `README.md`.

### Changed
- **Self-hosted all runtime third-party assets** (removed every runtime CDN):
  Cytoscape 3.23.0, cytoscape-navigator 2.0.2, cytoscape-svg 0.4.0, and the
  web-ifc 0.0.44 engine (JS glue + matching WASM) are now vendored under
  `src/vendor/`; Archivo / IBM Plex Sans / IBM Plex Mono are self-hosted WOFF2
  under `assets/fonts/` (Google Fonts `<link>` removed).
- The optional AI plugin now calls the Anthropic Messages HTTP API **directly**
  (browser-access header) instead of importing the SDK from `esm.sh` — one fewer
  CDN supply-chain path; the only possible AI destination is the configured
  Anthropic endpoint, and it is deployment-gated.
- README license corrected from a broken MIT claim (no file existed) to
  Apache-2.0; removed a dead banner-image reference and a stale license section.

### Security
- A default page load now contacts **no third-party host**. The only optional
  egress is the local MCP bridge (`ws://localhost:8765`) and, when enabled and
  used with a user's own key, `https://api.anthropic.com` — both documented and
  regression-tested.

### Notes
- **Redistribution caveat:** the optional *Export SVG* feature uses a **GPL-3.0**
  component (`cytoscape-svg`); see `THIRD-PARTY-NOTICES.md`. Running ONEXUS is
  unaffected.
- The `onexus-backend/` service remains **no-auth by design** (local/trusted
  network only).

[Unreleased]: https://github.com/onuresen/onexus/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/onuresen/onexus/releases/tag/v1.0.0
