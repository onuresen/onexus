# Third-Party Notices

ONEXUS ("the Work") is licensed under Apache-2.0 (see `LICENSE`). It bundles,
vendors, or optionally loads the third-party components inventoried below. Each
component remains under its own license; this file records what those licenses
are so that an operator or legal reviewer can assess redistribution and use.

Scope key:

- **Bundled (distributed)** — shipped in this repository / any release archive
  and served to the browser at runtime. Redistribution obligations apply.
- **Optional runtime** — only reached when a specific optional feature is
  enabled and used; no third-party *code* is redistributed by ONEXUS.
- **Development only** — used to build, lint, or test; never served to end users
  or included in a release archive.
- **Separate service** — an optional companion process a deployer runs on their
  own (backend / MCP server); its dependencies are installed by the deployer,
  not distributed inside the ONEXUS web app.

---

## Bundled (distributed with the web app)

| Component | Version | License | Location |
|---|---|---|---|
| [Cytoscape.js](https://js.cytoscape.org/) | 3.23.0 | MIT | `src/vendor/cytoscape.3.23.0.min.js` |
| [cytoscape-navigator](https://github.com/cytoscape/cytoscape.js-navigator) | 2.0.2 | MIT | `src/vendor/cytoscape-navigator.2.0.2.js` / `.css` |
| [canvas2svg](https://github.com/gliffy/canvas2svg) | 1.0.16 | MIT | `src/vendor/canvas2svg.1.0.16.js` — SVG-export engine |
| [D3](https://d3js.org/) | 7.9.0 | ISC | `src/vendor/d3.v7.9.0.min.js` |
| [d3-sankey](https://github.com/d3/d3-sankey) | 0.12.3 | BSD-3-Clause | `src/vendor/d3-sankey.v0.12.3.min.js` |
| [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | 0.0.44 | MPL-2.0 | `src/vendor/web-ifc/web-ifc-api.js` + `web-ifc.wasm` |
| [Archivo](https://github.com/Omnibus-Type/Archivo) (font) | 5.3.0¹ | OFL-1.1 | `assets/fonts/archivo-latin-*.woff2` |
| [IBM Plex Sans](https://github.com/IBM/plex) (font) | 5.3.0¹ | OFL-1.1 | `assets/fonts/ibm-plex-sans-latin-*.woff2` |
| [IBM Plex Mono](https://github.com/IBM/plex) (font) | 5.3.0¹ | OFL-1.1 | `assets/fonts/ibm-plex-mono-latin-*.woff2` |

¹ Font WOFF2 files are the Latin subset vendored from the corresponding
`@fontsource/*` npm package (the package version is shown; the packages
themselves are MIT, the font outlines are OFL-1.1).

### SVG export is GPL-free

"Export SVG" previously relied on the GPL-3.0 `cytoscape-svg` wrapper. It has been
**replaced**: SVG serialization now uses the MIT-licensed `canvas2svg` engine
plus ONEXUS's own Apache-2.0 `cy.svg()` glue (`src/helpers/onexus-cy-svg.js`).
The full distribution is therefore Apache-2.0-compatible; there is no remaining
copyleft component. Do not reintroduce `cytoscape-svg`.

---

## Optional runtime (reached only when the feature is enabled and used)

| Destination | Trigger | Notes |
|---|---|---|
| `https://api.anthropic.com` | User enables AI in deployment policy **and** enters their own Anthropic API key **and** invokes the "What-if?" narration | ONEXUS calls the Anthropic Messages HTTP API **directly** (browser `fetch` with the `anthropic-dangerous-direct-browser-access` header). No Anthropic SDK or other third-party code is bundled or fetched from a CDN. Governed by `src/config/onexus-enterprise.config.js` (`ai.enabled`, default on; a deployment can set it to `false` to remove the feature and its egress entirely). |

No other third-party network destination is contacted by a default page load.
See `PRIVACY.md` for the full egress table.

---

## Development only (not served to end users, not in release archives)

| Component | License |
|---|---|
| eslint, @eslint/js | MIT |
| prettier | MIT |
| playwright | Apache-2.0 |
| http-server | MIT |
| globals | MIT |

Pinned in `package.json` / `package-lock.json`.

---

## Separate services (optional companion processes, installed by the deployer)

**`onexus-backend/`** (optional Express.js graph store, run separately):

| Component | License |
|---|---|
| express | MIT |

**`onexus-mcp/`** (optional Python MCP server, run separately):

| Component | License |
|---|---|
| fastmcp | Apache-2.0 |
| websockets | BSD-3-Clause |

These are installed by the operator via `npm install` / `pip install` in their
own environment and are **not** part of the distributed web app.

---

_To regenerate the version/license facts in this file, run `npm view <pkg> license`
for each component, or inspect each vendored file's header and its upstream
`package.json`. Update this file whenever a vendored asset is added, removed, or
version-bumped._
