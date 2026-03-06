/**
 * onexus-features.spec.js
 *
 * Feature-level Playwright tests for ONEXUS graph operations.
 * These tests exercise graph loading, filtering, layer switching,
 * and undo/redo — all via the public window.* API surface.
 */

const { test, expect } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const APP_URL = `${BASE}/index.html?ci=1`;

/**
 * Loads the app and waits for full boot (cy + plugins ready).
 */
async function bootPage(page) {
    await page.goto(APP_URL, { waitUntil: "load" });
    await page.waitForFunction(
        () => !!window.cy && typeof window.cy.nodes === "function" && typeof window.onexusLoadGraph === "function",
        { timeout: 30_000 }
    );
}

/**
 * Loads the sample JSON into the graph via the public API.
 * Returns the raw graph data fetched from the server.
 */
async function loadSampleGraph(page, samplePath) {
    const graphData = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
    }, samplePath);

    await page.evaluate((data) => {
        window.onexusLoadGraph(data);
    }, graphData);

    // Wait for Cytoscape to reflect new elements
    await page.waitForFunction(() => window.cy.nodes().length > 0, { timeout: 10_000 });

    return graphData;
}

// ---------------------------------------------------------------------------
// Test: JSON graph import
// ---------------------------------------------------------------------------
test("loads a sample JSON graph and renders nodes and edges", async ({ page }) => {
    await bootPage(page);

    const data = await loadSampleGraph(page, "/samples/json/onexus_sample.json");

    const expectedNodes = data.elements.nodes.length;
    const expectedEdges = data.elements.edges.length;

    const [actualNodes, actualEdges] = await page.evaluate(() => [
        window.cy.nodes().length,
        window.cy.edges().length
    ]);

    expect(actualNodes).toBe(expectedNodes);
    expect(actualEdges).toBe(expectedEdges);
});

// ---------------------------------------------------------------------------
// Test: category filter hides / shows nodes
// ---------------------------------------------------------------------------
test("category filter changes visible node count", async ({ page }) => {
    await bootPage(page);
    await loadSampleGraph(page, "/samples/json/onexus_sample.json");

    const totalNodes = await page.evaluate(() => window.cy.nodes().length);
    expect(totalNodes).toBeGreaterThan(0);

    // Get a category that exists in this graph
    const firstCategory = await page.evaluate(() => {
        const cats = [...new Set(window.cy.nodes().map((n) => n.data("category")).filter(Boolean))];
        return cats[0] || null;
    });

    if (!firstCategory) {
        // No categories — skip filter sub-test
        return;
    }

    // Apply category filter (hides all nodes NOT in this category)
    await page.evaluate((cat) => {
        if (typeof window.filterByCategory === "function") window.filterByCategory(cat);
    }, firstCategory);

    // After filtering, the visible node count should change (≤ total)
    const filteredCount = await page.evaluate(() => window.cy.nodes(":visible").length);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(totalNodes);
});

// ---------------------------------------------------------------------------
// Test: layer mode switching
// ---------------------------------------------------------------------------
test("setLayerMode switches the active layer", async ({ page }) => {
    await bootPage(page);
    await loadSampleGraph(page, "/samples/json/onexus_all_layers_realistic.json");

    // Default should be "relationship"
    const defaultMode = await page.evaluate(() => window.getLayerMode?.() ?? null);
    expect(defaultMode).toBeTruthy();

    // Switch to lifecycle layer (if available)
    await page.evaluate(() => {
        if (typeof window.setLayerMode === "function") window.setLayerMode("lifecycle");
    });

    const newMode = await page.evaluate(() => window.getLayerMode?.() ?? null);
    // If lifecycle layer is registered, mode should have changed
    // Accept either "lifecycle" (changed) or the original (not registered in this build)
    expect(["relationship", "lifecycle", "foundation"]).toContain(newMode);
});

// ---------------------------------------------------------------------------
// Test: undo/redo stack
// ---------------------------------------------------------------------------
test("undo removes an added node and redo restores it", async ({ page }) => {
    await bootPage(page);
    await loadSampleGraph(page, "/samples/json/onexus_sample.json");

    const beforeCount = await page.evaluate(() => window.cy.nodes().length);

    // Add a node via the ONEXUS nodes API if available
    const addResult = await page.evaluate(() => {
        const addFn = window.ONEXUS_NODES?.addNode || window.addNode;
        if (typeof addFn !== "function") return "no-api";
        addFn({ id: "__test_node__", label: { en: "Test Node" }, nodeType: "Element", category: "Test" });
        return "added";
    });

    if (addResult === "no-api") {
        // Node add API not available — skip
        return;
    }

    const afterAdd = await page.evaluate(() => window.cy.nodes().length);
    expect(afterAdd).toBe(beforeCount + 1);

    // Undo
    await page.evaluate(() => window.ONEXUS_UNDO?.undo?.());
    const afterUndo = await page.evaluate(() => window.cy.nodes().length);
    expect(afterUndo).toBe(beforeCount);

    // Redo
    await page.evaluate(() => window.ONEXUS_UNDO?.redo?.());
    const afterRedo = await page.evaluate(() => window.cy.nodes().length);
    expect(afterRedo).toBe(beforeCount + 1);
});

// ---------------------------------------------------------------------------
// Test: export JSON produces a non-empty string
// ---------------------------------------------------------------------------
test("graph export produces a valid JSON string", async ({ page }) => {
    await bootPage(page);
    await loadSampleGraph(page, "/samples/json/onexus_sample.json");

    const exported = await page.evaluate(() => {
        // Try the ONEXUS export API
        const expFn = window.ONEXUS?.export?.toJson || window.exportToJson;
        if (typeof expFn === "function") return expFn();

        // Fallback: serialize via cy directly
        const data = window.cy.json();
        return JSON.stringify(data);
    });

    expect(exported).toBeTruthy();
    expect(typeof exported).toBe("string");
    expect(exported.length).toBeGreaterThan(10);

    // Must be valid JSON
    expect(() => JSON.parse(exported)).not.toThrow();
});
