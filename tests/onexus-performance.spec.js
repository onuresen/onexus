const { test, expect } = require("playwright/test");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";

function makeGraph(nodeCount, edgeCount) {
    const nodes = Array.from({ length: nodeCount }, (_, index) => ({
        data: {
            id: `perf-node-${index}`,
            nodeType: index % 5 === 0 ? "Space" : "Component",
            category: `Category ${index % 12}`,
            label: `Performance node ${index}`,
        },
    }));
    const edges = Array.from({ length: edgeCount }, (_, index) => {
        const sourceIndex = index % nodeCount;
        const targetOffset = Math.floor(index / nodeCount) + 1;
        return { data: {
            id: `perf-edge-${index}`,
            source: `perf-node-${sourceIndex}`,
            target: `perf-node-${(sourceIndex + targetOffset) % nodeCount}`,
            type: index % 7 === 0 ? "blocks" : "depends_on",
            dimension: index % 3 === 0 ? "Schedule" : "System",
            directional: true,
        } };
    });
    return {
        meta: { schema: "onexus-1.1", project: `Performance ${nodeCount}` },
        elements: { nodes, edges },
    };
}

async function boot(page) {
    await page.goto(`${BASE}/index.html?ci=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.cy && window.onexusLoadGraph);
}

for (const tier of [
    { name: "small", nodes: 50, edges: 100, budgetMs: 1_500 },
    { name: "medium", nodes: 500, edges: 1_500, budgetMs: 5_000 },
    { name: "large", nodes: 2_000, edges: 6_000, budgetMs: 60_000 },
]) {
    test(`performance baseline: ${tier.name} graph`, async ({ page }, testInfo) => {
        await boot(page);
        const graph = makeGraph(tier.nodes, tier.edges);
        const measurement = await page.evaluate(async (payload) => {
            const started = performance.now();
            const layoutStopped = new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), 60_000);
                window.cy.one("layoutstop", () => {
                    clearTimeout(timer);
                    resolve(true);
                });
            });
            window.onexusLoadGraph(payload);
            const graphLoadedMs = performance.now() - started;
            const layoutCompleted = await layoutStopped;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {
                graphLoadedMs,
                interactiveMs: performance.now() - started,
                layoutCompleted,
                nodes: window.cy.nodes().length,
                edges: window.cy.edges().length,
            };
        }, graph);

        await testInfo.attach(`${tier.name}-performance.json`, {
            body: Buffer.from(JSON.stringify(measurement, null, 2)),
            contentType: "application/json",
        });
        expect(measurement.nodes).toBe(tier.nodes);
        expect(measurement.edges).toBe(tier.edges);
        expect(measurement.layoutCompleted).toBe(true);
        expect(measurement.interactiveMs).toBeLessThan(tier.budgetMs);
    });
}
