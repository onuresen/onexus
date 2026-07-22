# Deployment & Administration Guide

For an operator deploying ONEXUS inside an organization. ONEXUS is a **static,
no-build browser app** — deployment is "serve a folder of files over HTTPS."
There is no runtime to patch, no database to provision, and no accounts to
manage. The optional backend and MCP server are separate, local-only tools.

## Supported topology

| Component | What it is | Where it runs | Auth |
|---|---|---|---|
| **ONEXUS web app** (this repo root) | Static HTML/JS/CSS | Any static host (GitHub Pages, nginx, S3+CloudFront, internal web server) | None (no accounts) |
| **`onexus-backend/`** (optional) | Express.js graph store | A trusted host / workstation | **None by design** |
| **`onexus-mcp/`** (optional) | Python MCP + WebSocket `:8765` | A developer's local machine | Local only |

The web app is fully functional on its own (open `index.html`, drag in data).
The backend and MCP server are optional and independent.

## Serve the web app

Serve the repository root as static files. Any of:

```bash
npx http-server -p 4173 -c-1 .      # quick
python -m http.server 4173          # quick
# or copy the folder to nginx / GitHub Pages / a static bucket
```

Always serve over **HTTPS** in a real deployment.

### Recommended HTTP response headers

ONEXUS ships a `<meta>` CSP, but several protections can only be delivered as
**real HTTP headers** at the hosting layer. Configure your web server / CDN to
send:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:8765 https://api.anthropic.com; worker-src 'self' blob:; form-action 'self'; frame-ancestors 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
```

Notes:

- A header-level CSP **supersedes** the `<meta>` one and can add `frame-ancestors`
  (which `<meta>` cannot deliver).
- `'unsafe-inline'` for scripts/styles is required by the no-build architecture
  (inline event handlers); `'wasm-unsafe-eval'` is required by the on-demand IFC
  importer. These are documented, deliberate allowances.
- **If you disable AI** (below), tighten `connect-src` by removing
  `https://api.anthropic.com`. **If you don't run the MCP server**, remove
  `ws://localhost:8765` too. With both removed, `connect-src 'self'` is exact.

## Feature policy (allow/deny)

Deployment-owned policy lives in **`src/config/onexus-enterprise.config.js`**.
It is static and cannot be overridden from the UI, localStorage, or a graph file.

```js
window.ONEXUS_ENTERPRISE = Object.freeze({
  ai: Object.freeze({
    enabled: true,   // set false to remove the AI feature entirely (fail closed)
    endpoint: "https://api.anthropic.com/v1/messages",
    apiVersion: "2023-06-01",
    model: "claude-haiku-4-5",
  }),
});
```

- **To forbid AI:** set `ai.enabled: false` **and** remove
  `https://api.anthropic.com` from the CSP `connect-src`. With the switch off, the
  🔮 button is not rendered, key storage/read is refused, and no request is
  possible — independent of any key a user may have entered before. Belt (policy)
  and braces (CSP).
- **To allow AI:** users supply their **own** Anthropic key (stored in their own
  browser; sent only to Anthropic). ONEXUS bundles no key and no SDK.

## Browser / device policy

- Target modern Chromium/Edge/Firefox. WebAssembly is required only for IFC
  import.
- **Shared devices:** a user's Anthropic key persists in that browser profile in
  plaintext. On shared/kiosk devices, either disable AI by policy or ensure
  profiles are cleared between users. Browser-profile separation is **not**
  authentication.

## The optional backend

`onexus-backend/` has **no authentication by design** — local/trusted-network
only. Configuration (env):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `ONEXUS_STORAGE_DIR` | (repo-local) | Where graph JSON files are stored |
| `ONEXUS_ALLOWED_ORIGIN` | — | CORS allow-origin |
| `ONEXUS_MAX_ELEMENTS` | `200000` | Rejects oversized graphs (DoS guard) |

```bash
cd onexus-backend && npm install && node server.js
```

**Never expose it to an untrusted network or the public internet without a
reverse proxy that adds TLS and authentication.** Its guards (element cap,
duplicate-id rejection, JSON-only errors, 413 on oversized bodies) are
robustness measures, not access control.

## Pre-deployment checklist

- [ ] Serving over HTTPS.
- [ ] Recommended HTTP headers configured (CSP superset, HSTS, nosniff, referrer).
- [ ] AI policy decided (`ai.enabled`) and CSP `connect-src` matched to it.
- [ ] MCP/backend servers, if used, are on a trusted network only.
- [ ] Pinned to a reviewed **release tag + checksum**, not a moving branch
      (see `docs/RELEASING.md`).
- [ ] `npm run lint` and `npm run test:smoke` green at the pinned commit.

## Backup & restore

- The web app is **stateless** — the files are the artifact. "Backup" = keep the
  release archive + checksum.
- **User data** lives in each user's browser `localStorage`; users export graphs
  as JSON for their own portability. There is nothing central to back up for the
  web app.
- **Backend data** = the files in `ONEXUS_STORAGE_DIR`. Back up that directory
  with your normal file-backup process; restore by copying it back.

## Upgrade & rollback

- **Upgrade:** deploy the new reviewed release atomically (swap the served folder
  / update the Pages commit). Because the app is static, upgrade is a file
  replacement; there is no migration step for the web app itself.
- **Rollback:** redeploy the previous release archive (verify its SHA-256). Keep
  at least one prior release retrievable.
- **Data-schema note:** ONEXUS reads legacy `onexus-1.x` files and normalizes
  edges to `onexus.relationship.v1` on import without invalidating old files, so
  downgrades do not corrupt existing data files.

## Incident response

- Suspected vulnerability: follow `SECURITY.md` (private report). Roll back to a
  known-good release if needed.
- Suspected key exposure on a shared device: clear that browser's site data /
  the `onexus.ai.v1` key and rotate the Anthropic key at the provider.
- Because the web app has no server and no accounts, there is no session to
  revoke or credential store to purge centrally.

## Offboarding

- Removing access = removing the user's access to the hosting URL (your normal
  network/SSO-at-the-proxy controls, since ONEXUS itself has no accounts).
- To wipe local traces on a device: clear browser site data for the ONEXUS
  origin. Delete any backend files the user created if applicable.

## What this deployment does NOT give you

No SSO, RBAC, central user management, audit log, or SLA — ONEXUS has no identity
system. See `SECURITY.md` → "Known limitations." Enforce organizational access
control at the hosting/proxy layer.
