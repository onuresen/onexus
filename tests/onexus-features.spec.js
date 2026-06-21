/**
 * onexus-features.spec.js
 *
 * A small set of HIGH-SIGNAL regression tests (no soft-skips) covering the
 * behaviour that actually matters: that a graph loads with full fidelity, and
 * that "Export Graph JSON" exports the COMPLETE graph even when a filter is
 * hiding part of it. If either of these breaks, the app is genuinely broken.
 */

const { test, expect } = require("playwright/test");
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

// ---------------------------------------------------------------------------
// Security: untrusted graph values rendered into the details panel must be
// escaped, not interpreted as HTML.
// ---------------------------------------------------------------------------
test("details panel escapes untrusted graph text", async ({ page }) => {
    await bootPage(page);

    const payload = `<img src=x onerror="window.__onexusXss = 1">`;
    await page.evaluate((maliciousText) => {
        window.__onexusXss = 0;
        window.onexusLoadGraph({
            meta: { schema: "onexus-1.1", project: "XSS regression" },
            elements: {
                nodes: [{
                    data: {
                        id: "xss-node",
                        displayLabel: maliciousText,
                        nodeType: maliciousText,
                        category: maliciousText,
                        level: maliciousText,
                        ifcProperties: {
                            [maliciousText]: { [maliciousText]: maliciousText },
                        },
                    },
                }],
                edges: [],
            },
        });
        window.cy.getElementById("xss-node").emit("tap");
    }, payload);

    await page.waitForTimeout(100);

    const result = await page.evaluate(() => ({
        executed: window.__onexusXss,
        injectedImages: document.querySelectorAll("#onxFloatDetailsBody img").length,
        detailsText: document.querySelector("#onxFloatDetailsBody")?.textContent ?? "",
    }));

    expect(result.executed).toBe(0);
    expect(result.injectedImages).toBe(0);
    expect(result.detailsText).toContain(payload);
});

// ---------------------------------------------------------------------------
// Edge-type styling: different relationship types must render with visibly
// distinct colors (blocking vs dependency vs supply), not collapse to the
// same flat gray. Regression guard for edgeColorByType's hash fallback.
// ---------------------------------------------------------------------------
test("edges with different relationship types get distinct line colors", async ({ page }) => {
    await bootPage(page);
    const data = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
    }, "/samples/json/onexus_ic_supply_chain_sample.json");
    await page.evaluate((d) => window.onexusLoadGraph(d), data);
    await page.waitForFunction(() => window.cy.edges().length > 0, { timeout: 10_000 });

    const colorsByType = await page.evaluate(() => {
        const out = {};
        window.cy.edges().forEach((e) => {
            const t = e.data("type");
            if (t && !(t in out)) out[t] = e.style("line-color");
        });
        return out;
    });

    // The sample mixes "blocks" (must read as risk/blocking) with structural
    // types like "supplies"/"requires" — they must not share a color.
    expect(colorsByType.blocks).toBeTruthy();
    expect(colorsByType.supplies).toBeTruthy();
    expect(colorsByType.blocks).not.toBe(colorsByType.supplies);
    expect(colorsByType.blocks).not.toBe("rgb(153,153,153)"); // not the old flat-gray fallback

    const distinctColors = new Set(Object.values(colorsByType));
    expect(distinctColors.size).toBe(Object.keys(colorsByType).length); // every type is visually distinguishable
});

// ---------------------------------------------------------------------------
// Edge-type arrow shape must hold at every LOD tier. The "edge.lod-high"
// class (applied at high zoom — see applyLOD) has its own target-arrow-shape
// rule; it previously hardcoded directional-only "triangle", silently
// overriding the category-aware arrow (tee/triangle/circle/diamond) the
// instant a graph zoomed in. Guard both tiers explicitly.
// ---------------------------------------------------------------------------
test("blocking edges render a distinct arrow shape, including at high LOD", async ({ page }) => {
    await bootPage(page);
    const data = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
    }, "/samples/json/onexus_ic_supply_chain_sample.json");
    await page.evaluate((d) => window.onexusLoadGraph(d), data);
    await page.waitForFunction(() => window.cy.edges().length > 0, { timeout: 10_000 });

    const arrowsByType = await page.evaluate(() => {
        const out = {};
        window.cy.edges().forEach((e) => {
            const t = e.data("type");
            if (t && !(t in out)) out[t] = e.style("target-arrow-shape");
        });
        return out;
    });

    // "blocks" is the blocking category (tee); "supplies"/"requires" are the
    // dependency category (triangle) — they must read as different shapes.
    expect(arrowsByType.blocks).toBe("tee");
    expect(arrowsByType.supplies).toBe("triangle");

    // Force the high-LOD class on, the way applyLOD would at close zoom, and
    // confirm the category-aware arrow survives (this is the regression the
    // bug above would have broken).
    await page.evaluate(() => {
        window.cy.edges().addClass("lod-high");
    });
    const blocksArrowAtHighLod = await page.evaluate(() =>
        window.cy.edges('[type = "blocks"]').first().style("target-arrow-shape")
    );
    expect(blocksArrowAtHighLod).toBe("tee");
});
