const { test, expect } = require("playwright/test");

/*
 * Network-egress boundary test (enterprise-readiness Group C).
 *
 * Proves the documented allowlist: a default ONEXUS page load contacts NO
 * third-party host. All libraries, fonts, and the IFC/WASM engine are
 * self-hosted, so every HTTP(S) request must be same-origin. This test fails
 * the moment someone re-introduces a CDN <link>/<script> or a runtime fetch to
 * an external host — which is exactly the regression it exists to catch.
 *
 * See PRIVACY.md (egress table) and THIRD-PARTY-NOTICES.md.
 */

const FORBIDDEN_HOST_PATTERNS = [
    /fonts\.googleapis\.com/,
    /fonts\.gstatic\.com/,
    /unpkg\.com/,
    /cdnjs\.cloudflare\.com/,
    /cdn\.jsdelivr\.net/,
    /esm\.sh/,
    /api\.anthropic\.com/, // must not be hit on a default load (AI is user-initiated)
];

test("default page load makes zero third-party network requests", async ({ page }) => {
    const base = process.env.BASE_URL || "http://127.0.0.1:4173";
    const appOrigin = new URL(base).origin;

    const offOrigin = [];
    page.on("request", (req) => {
        const url = req.url();
        if (/^(data|blob|about):/.test(url)) return; // not network
        let origin;
        try { origin = new URL(url).origin; } catch { return; }
        if (origin !== appOrigin) offOrigin.push(url);
    });

    await page.goto(`${base}/index.html?ci=1`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.cy && typeof window.cy.nodes === "function");
    // Give autoloaded plugins a beat to do any (non-)fetching they might attempt.
    await page.waitForTimeout(1500);

    // No request left the app origin at all.
    expect(offOrigin, `unexpected off-origin requests:\n${offOrigin.join("\n")}`).toEqual([]);

    // And specifically none of the known former-CDN / AI hosts were contacted.
    const forbidden = offOrigin.filter((u) => FORBIDDEN_HOST_PATTERNS.some((re) => re.test(u)));
    expect(forbidden).toEqual([]);
});

test("core libraries and fonts are served from the app origin, not a CDN", async ({ page }) => {
    const base = process.env.BASE_URL || "http://127.0.0.1:4173";
    const appOrigin = new URL(base).origin;

    const seen = [];
    page.on("request", (req) => seen.push(req.url()));

    await page.goto(`${base}/index.html?ci=1`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.cytoscape === "function");

    // Cytoscape must have loaded from src/vendor on the app origin.
    const cyReq = seen.find((u) => /\/src\/vendor\/cytoscape\.3\.23\.0\.min\.js$/.test(u));
    expect(cyReq, "vendored cytoscape not requested from src/vendor").toBeTruthy();
    expect(new URL(cyReq).origin).toBe(appOrigin);

    // A self-hosted font stylesheet must be present and same-origin.
    const fontCss = seen.find((u) => /\/assets\/fonts\/fonts\.css$/.test(u));
    expect(fontCss, "self-hosted fonts.css not requested").toBeTruthy();
    expect(new URL(fontCss).origin).toBe(appOrigin);
});

test("a Content-Security-Policy is present and self-anchored", async ({ page }) => {
    const base = process.env.BASE_URL || "http://127.0.0.1:4173";
    await page.goto(`${base}/index.html?ci=1`, { waitUntil: "load" });

    const csp = await page.evaluate(() => {
        const el = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
        return el ? el.getAttribute("content") : null;
    });
    expect(csp, "no CSP meta tag found").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // Fonts must be same-origin only (no CDN font host allowed).
    expect(csp).toContain("font-src 'self'");
});
