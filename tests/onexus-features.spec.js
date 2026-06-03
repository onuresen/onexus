/**
 * onexus-features.spec.js
 *
 * A small set of HIGH-SIGNAL regression tests (no soft-skips) covering the
 * behaviour that actually matters: that a graph loads with full fidelity, and
 * that "Export Graph JSON" exports the COMPLETE graph even when a filter is
 * hiding part of it. If either of these breaks, the app is genuinely broken.
 */

const { test, expect } = require("@playwright/test");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const APP_URL = `${BASE}/index.html?ci=1`;
const SAMPLE = "/samples/json/onexus_sample.json";

async function bootPage(page) {
    await page.goto(APP_URL, { waitUntil: "load" });
    await page.waitForFunction(
        () => !!window.cy && typeof window.cy.nodes === "function" && typeof window.onexusLoadGraph === "function",
        { timeout: 30_000 }
    );
}

async function loadSample(page) {
    const data = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
    }, SAMPLE);
    await page.evaluate((d) => window.onexusLoadGraph(d), data);
    await page.waitForFunction(() => window.cy.nodes().length > 0, { timeout: 10_000 });
    return data;
}

// ---------------------------------------------------------------------------
// Load fidelity: every node/edge in the file ends up in the graph.
// ---------------------------------------------------------------------------
test("loads a sample JSON graph with full node/edge fidelity", async ({ page }) => {
    await bootPage(page);
    const data = await loadSample(page);

    const [nodes, edges] = await page.evaluate(() => [
        window.cy.nodes().length,
        window.cy.edges().length,
    ]);

    expect(nodes).toBe(data.elements.nodes.length);
    expect(edges).toBe(data.elements.edges.length);
});

// ---------------------------------------------------------------------------
// Export completeness: a category filter hides nodes in the view, but
// exportJSON must still write the FULL graph (regression guard for the fix
// that changed cy.nodes(":visible") -> cy.nodes()).
// ---------------------------------------------------------------------------
test("exportJSON writes the complete graph even when a filter hides nodes", async ({ page }) => {
    await bootPage(page);
    const data = await loadSample(page);
    const totalNodes = data.elements.nodes.length;

    // Pick a real category and filter to it so some nodes become hidden.
    const cat = await page.evaluate(() => {
        const cats = [...new Set(window.cy.nodes().map((n) => n.data("category")).filter(Boolean))];
        return cats[0] ?? null;
    });
    expect(cat).toBeTruthy(); // the sample is expected to have categories

    await page.evaluate((c) => window.filterByCategory(c), cat);

    const visible = await page.evaluate(() => window.cy.nodes(":visible").length);
    expect(visible).toBeLessThan(totalNodes); // filter actually hid something

    // Trigger the real export and capture the downloaded file.
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => window.exportJSON());
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf-8"));

    // Export must contain ALL nodes, not just the visible subset.
    expect(exported.elements.nodes.length).toBe(totalNodes);
    expect(exported.elements.edges.length).toBe(data.elements.edges.length);
});
