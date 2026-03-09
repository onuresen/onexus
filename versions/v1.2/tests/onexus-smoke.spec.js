const { test, expect } = require("@playwright/test");

test("ONEXUS boots, loads plugins, passes audit + selftest", async ({ page }) => {
    const base = process.env.BASE_URL || "http://127.0.0.1:4173";
    const url = `${base}/index.html?ci=1`;

    const consoleErrors = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
        consoleErrors.push(String(err?.message || err));
    });

    await page.goto(url, { waitUntil: "load" });

    // Core boot: Cytoscape created in graph-core.state.js (window.cy) [5](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.bindings.js)
    await page.waitForFunction(() => !!window.cy && typeof window.cy.nodes === "function");

    // Plugin autoload: manifest.json -> importers registered via onexus-plugin-autoload.js [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-selftest.js)[3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-depgraph.js)
    await page.waitForFunction(() => {
        const P = window.ONEXUS?.plugins;
        const list = (typeof P?.listImporters === "function") ? P.listImporters() : (P?.importers || []);
        return Array.isArray(list) && list.length > 0;
    }, { timeout: 30_000 });

    // Runtime audit must exist and should report no missing globals [2](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-audit.runtime.js)
    const audit = await page.evaluate(() => {
        return window.ONEXUS_AUDIT?.run?.({ verbose: false }) || null;
    });
    expect(audit).toBeTruthy();
    expect(audit.counts.globalsBad).toBe(0);

    // Selftest runs rollbackable checks (snapshot/restore) [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-selftest.js)
    await page.evaluate(async () => {
        await window.ONEXUS_SELFTEST?.run?.();
    });

    // Ensure some importer ids exist (manifest-driven plugins) [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus-depgraph.js)
    const importerIds = await page.evaluate(() => {
        const P = window.ONEXUS?.plugins;
        const list = (typeof P?.listImporters === "function") ? P.listImporters() : (P?.importers || []);
        return (list || []).map(x => x.id);
    });
    expect(importerIds.length).toBeGreaterThan(0);

    // Fail on any console errors during boot/test
    expect(consoleErrors).toEqual([]);
});