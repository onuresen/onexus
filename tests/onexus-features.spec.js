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
const SAMPLE = "/samples/json/onexus_smart_access_flagship.json";

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
    await page.waitForTimeout(650);
    await page.evaluate(() => window.ONEXUS_SCENARIOS?.hideChooser?.());
    return data;
}

function captureRuntimeErrors(page) {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    return errors;
}

test("flagship opens a three-story chooser backed by reusable scenario data", async ({ page }) => {
    await page.goto(
        `${BASE}/index.html?ci=1&sample=smart-access-connected-door`,
        { waitUntil: "load" }
    );
    await page.waitForFunction(
        () => window.cy?.getElementById("door-main")?.nonempty?.() &&
            window.ONEXUS_SCENARIOS?.list?.().length === 3 &&
            document.querySelector("#onx-story-chooser")?.style.display === "flex",
        { timeout: 30_000 }
    );

    const chooser = page.locator("#onx-story-chooser");
    await expect(chooser).toBeVisible();
    const cards = page.locator(".onx-story-card");
    await expect(cards).toHaveCount(3);
    await expect(page.locator("#onx-story-heading")).toHaveText("Choose a story");

    const impactCard = page.locator('[data-scenario="delivery-impact"]');
    await expect(impactCard).toHaveCount(1);
    await impactCard.click();

    await page.waitForFunction(
        () => window.ONEXUS_TOUR?.current?.().name === "delivery-impact"
    );
    expect(new URL(page.url()).searchParams.get("scenario")).toBe("delivery-impact");
    await expect(chooser).toBeHidden();
    await expect(page.locator("#onexus-tour-title")).toHaveText(
        "A supplier reports a three-week delay"
    );
});

test("shareable connected-door URL loads the flagship and starts its guided story", async ({ page }) => {
    await page.goto(
        `${BASE}/index.html?ci=1&sample=smart-access-connected-door&scenario=connected-door`,
        { waitUntil: "load" }
    );
    await page.waitForFunction(
        () => window.cy?.getElementById("door-main")?.nonempty?.() &&
            window.ONEXUS_TOUR?.current?.().name === "connected-door",
        { timeout: 30_000 }
    );

    const result = await page.evaluate(() => ({
        project: window.__onexus_meta?.project,
        nodes: window.cy.nodes().length,
        edges: window.cy.edges().length,
        tour: window.ONEXUS_TOUR.current(),
        title: document.querySelector("#onexus-tour-title")?.textContent,
        selected: window.cy.nodes(":selected").map(n => n.id()),
        geometry: (() => {
            const node = window.cy.getElementById("door-main");
            const bb = node.renderedBoundingBox();
            const container = window.cy.container().getBoundingClientRect();
            const spot = document.querySelector("#onexus-tour-spot").getBoundingClientRect();
            const tip = document.querySelector("#onexus-tour-tip").getBoundingClientRect();
            return {
                expectedX: container.left + bb.x1 + bb.w / 2,
                expectedY: container.top + bb.y1 + bb.h / 2,
                spotX: spot.left + spot.width / 2,
                spotY: spot.top + spot.height / 2,
                separated: tip.right <= spot.left || tip.left >= spot.right ||
                    tip.bottom <= spot.top || tip.top >= spot.bottom,
            };
        })(),
    }));

    expect(result.project).toBe("Smart Access — Connected Door Story");
    expect(result.nodes).toBe(40);
    expect(result.edges).toBe(62);
    expect(result.tour.name).toBe("connected-door");
    expect(result.tour.total).toBe(6);
    expect(result.title).toBe("A door is never just a door");
    expect(result.selected).toContain("door-main");
    expect(Math.abs(result.geometry.spotX - result.geometry.expectedX)).toBeLessThan(2);
    expect(Math.abs(result.geometry.spotY - result.geometry.expectedY)).toBeLessThan(2);
    expect(result.geometry.separated).toBe(true);
});

test("delivery-impact URL traces the flagship delay into cost and decision nodes", async ({ page }) => {
    await page.goto(
        `${BASE}/index.html?ci=1&sample=smart-access-connected-door&scenario=delivery-impact`,
        { waitUntil: "load" }
    );
    await page.waitForFunction(
        () => window.cy?.getElementById("issue-reader-delay")?.nonempty?.() &&
            window.ONEXUS_TOUR?.current?.().name === "delivery-impact",
        { timeout: 30_000 }
    );

    const result = await page.evaluate(() => ({
        tour: window.ONEXUS_TOUR.current(),
        title: document.querySelector("#onexus-tour-title")?.textContent,
        delayDays: window.cy.getElementById("delivery-face-reader").data("delayDays"),
        costHigh: window.cy.getElementById("cost-delay-exposure").data("amountHigh"),
        officialDecision: window.cy.getElementById("decision-reader-mitigation").data("officialDecision"),
        impactEdges: window.cy.edges('[source = "issue-reader-delay"]').length,
    }));

    expect(result.tour.total).toBe(6);
    expect(result.title).toBe("A supplier reports a three-week delay");
    expect(result.delayDays).toBe(21);
    expect(result.costHigh).toBe(5_200_000);
    expect(result.officialDecision).toBe(false);
    expect(result.impactEdges).toBeGreaterThanOrEqual(3);
});

test("decision-intelligence URL preserves evidence, alternatives, and review status", async ({ page }) => {
    await page.goto(
        `${BASE}/index.html?ci=1&sample=smart-access-connected-door&scenario=decision-intelligence`,
        { waitUntil: "load" }
    );
    await page.waitForFunction(
        () => window.cy?.getElementById("decision-access-method")?.nonempty?.() &&
            window.ONEXUS_TOUR?.current?.().name === "decision-intelligence",
        { timeout: 30_000 }
    );

    const result = await page.evaluate(() => ({
        tour: window.ONEXUS_TOUR.current(),
        title: document.querySelector("#onexus-tour-title")?.textContent,
        officialDecision: window.cy.getElementById("decision-access-method").data("officialDecision"),
        reviewStatus: window.cy.getElementById("decision-access-method").data("reviewStatus"),
        options: window.cy.nodes('[nodeType = "Option"]').length,
        evidence: window.cy.nodes('[nodeType = "Evidence"]').length,
        selectedOptionEdges: window.cy.edges('[source = "decision-access-method"][type = "Selects"]').length,
        affectedDoorEdges: window.cy.edges('[source = "decision-access-method"][type = "Affects"]').length,
    }));

    expect(result.tour.total).toBe(6);
    expect(result.title).toBe("Begin with the decision question");
    expect(result.officialDecision).toBe(false);
    expect(result.reviewStatus).toBe("Reviewed");
    expect(result.options).toBe(3);
    expect(result.evidence).toBe(2);
    expect(result.selectedOptionEdges).toBe(1);
    expect(result.affectedDoorEdges).toBe(1);
});

// ---------------------------------------------------------------------------
// Alternate visualisations: these are lazy-loaded plugin views, so exercise
// the public layout selector path and verify the graph canvas is restored.
// ---------------------------------------------------------------------------
test("Sankey view renders flow data without errors and closes back to the graph", async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await bootPage(page);
    await loadSample(page);
    await page.waitForFunction(() =>
        [...document.querySelectorAll("#layoutSelect option")]
            .some((option) => option.value === "sankey")
    );

    await page.selectOption("#layoutSelect", "sankey");
    await page.waitForFunction(() => {
        const host = document.querySelector("#onx-sankey-host");
        const svg = document.querySelector("#onxSankeySvg");
        return host?.classList.contains("active") &&
            svg?.querySelectorAll("path, rect").length > 0;
    }, { timeout: 30_000 });

    await expect(page.locator("#onx-sankey-host")).toBeVisible();
    await expect(page.locator("#cy")).toHaveCSS("opacity", "0");
    expect(errors).toEqual([]);

    await page.click("#onxSankeyClose");
    await expect(page.locator("#onx-sankey-host")).not.toHaveClass(/active/);
    await expect(page.locator("#cy")).toHaveCSS("opacity", "1");
    await expect(page.locator("#cy")).toHaveCSS("pointer-events", "auto");
    expect(errors).toEqual([]);
});

test("Chord view renders, responds to zoom, and exits back to Cytoscape", async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await bootPage(page);
    await loadSample(page);
    await page.waitForFunction(() =>
        [...document.querySelectorAll("#layoutSelect option")]
            .some((option) => option.value === "chord")
    );

    await page.selectOption("#layoutSelect", "chord");
    await page.waitForFunction(() => {
        const host = document.querySelector("#onx-chord-host");
        const svg = document.querySelector("#onxChordSvg");
        return host?.classList.contains("active") &&
            svg?.querySelectorAll("path").length > 0;
    }, { timeout: 30_000 });

    await expect(page.locator("#onx-chord-host")).toBeVisible();
    await expect(page.locator("#cy")).toHaveCSS("opacity", "0");
    const chartGroup = page.locator("#onxChordSvg > g").first();
    const transformBefore = await chartGroup.getAttribute("transform");
    await page.locator("#onxChordSvg").hover();
    await page.mouse.wheel(0, -500);
    await expect.poll(() => chartGroup.getAttribute("transform"))
        .not.toBe(transformBefore);
    expect(errors).toEqual([]);

    await page.selectOption("#layoutSelect", "default");
    await expect(page.locator("#onx-chord-host")).not.toHaveClass(/active/);
    await expect(page.locator("#cy")).toHaveCSS("opacity", "1");
    await expect(page.locator("#cy")).toHaveCSS("pointer-events", "auto");
    expect(errors).toEqual([]);
});

test("graph validation reports duplicate IDs, unknown references, and orphan nodes", async ({ page }) => {
    await bootPage(page);
    const diagnostics = await page.evaluate(() => window.validateOnexusJson({
        elements: {
            nodes: [
                { data: { id: "duplicate", nodeType: "Component", category: "Test", label: "First" } },
                { data: { id: "duplicate", nodeType: "Component", category: "Test", label: "Second" } },
                { data: { id: "orphan", nodeType: "Component", category: "Test", label: "Orphan" } },
            ],
            edges: [{
                data: {
                    id: "bad-edge",
                    source: "duplicate",
                    target: "missing",
                    type: "depends_on",
                    dimension: "System",
                    directional: true,
                },
            }],
        },
    }));

    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.errors.join("\n")).toContain("duplicated");
    expect(diagnostics.errors.join("\n")).toContain("references unknown node");
    expect(diagnostics.warnings.join("\n")).toContain("orphan node");
    expect(diagnostics.stats.orphanNodes).toBe(1);
});

test("scenario diagnostics validate structure and resolve flagship graph references", async ({ page }) => {
    await bootPage(page);
    await loadSample(page);
    await page.waitForFunction(() => window.ONEXUS_SCENARIOS?.list?.().length === 3);

    const result = await page.evaluate(() => ({
        current: window.ONEXUS_SCENARIOS.diagnostics(),
        invalid: window.ONEXUS_SCENARIOS.validate({
            stories: [
                { id: "same", title: "First", steps: [{ id: "step", fitAll: true }] },
                { id: "same", title: "Second", steps: [{ id: "step", fitAll: true }] },
            ],
        }),
    }));

    expect(result.current.valid).toBe(true);
    expect(result.current.storyCount).toBe(3);
    expect(result.current.missingGraphReferences).toEqual([]);
    expect(result.invalid.valid).toBe(false);
    expect(result.invalid.errors.join("\n")).toContain("duplicated");
});

test("Relationship Intelligence mode traces impact and switches non-matches between dim and hide", async ({ page }) => {
    await bootPage(page);
    await loadSample(page);

    await page.click('[data-panel="panelRelationshipIntelligence"]');
    await expect(page.locator("#panelRelationshipIntelligence")).toBeVisible();
    await expect(page.locator("#onxRiQuality")).toContainText("link rate");
    await expect(page.locator("#onxRiHotspots .onx-ri-row")).toHaveCount(6);

    await page.evaluate(() => window.ONEXUS_RELATIONSHIP_INTELLIGENCE.focusNode("door-main"));
    await page.click('#onxRiDepth [data-depth="1"]');
    const oneHop = await page.evaluate(() => ({
        impacted: window.cy.nodes(".ri-impact").length,
        dimmed: window.cy.elements(".ri-dim").length,
        hidden: window.cy.elements(".ri-hide").length,
    }));
    expect(oneHop.impacted).toBeGreaterThan(1);
    expect(oneHop.dimmed).toBeGreaterThan(0);
    expect(oneHop.hidden).toBe(0);

    await page.click('#onxRiNonMatching [data-mode="hide"]');
    expect(await page.evaluate(() => window.cy.elements(".ri-hide").length)).toBeGreaterThan(0);

    await page.fill("#onxRiSearch", "decision");
    await expect(page.locator("#onxRiSearchCount")).toContainText("matching item");
});

test("canonical relationship contract normalizes legacy edges and preserves governed metadata", async ({ page }) => {
    await bootPage(page);
    const result = await page.evaluate(() => {
        const legacy = window.ONEXUS.import.normalizeGraph({
            elements: {
                nodes: [
                    { data: { id: "a", nodeType: "Component", category: "Test", label: "A" } },
                    { data: { id: "b", nodeType: "Component", category: "Test", label: "B" } },
                ],
                edges: [{ data: { id: "legacy", source: "a", target: "b", type: "relates", dimension: "System", directional: true, confidence: "Inferred", externalUrl: "https://example.com/item/1" } }],
            },
        });
        const governed = window.ONEXUS.import.normalizeRelationship({
            confidence: "Explicit",
            relationship: {
                truthClass: "governed",
                source: { system: "OneRoot", recordId: "DEC-42" },
                review: { status: "approved", reviewedBy: "Design Lead" },
            },
        });
        return { legacy: legacy.elements.edges[0].data, governed };
    });

    expect(result.legacy.relationship.contract).toBe("onexus.relationship.v1");
    expect(result.legacy.relationship.truthClass).toBe("inferred");
    expect(result.legacy.relationship.review.status).toBe("proposed");
    expect(result.legacy.relationship.source.url).toBe("https://example.com/item/1");
    expect(result.legacy.truthClass).toBe("inferred");
    expect(result.governed.truthClass).toBe("governed");
    expect(result.governed.source.system).toBe("OneRoot");
    expect(result.governed.review.status).toBe("approved");
});

test("OneRoot governance loop explicitly approves or rejects inferred relationship proposals", async ({ page }) => {
    await bootPage(page);
    await loadSample(page);
    await page.waitForFunction(() => !!window.ONEXUS_ONEROOT_GOVERNANCE, { timeout: 10_000 });

    const result = await page.evaluate(() => {
        const api = window.ONEXUS_ONEROOT_GOVERNANCE;
        const edge = window.cy.getElementById("e-issue-milestone");
        const before = api.currentRelationship(edge);
        const rejected = api.reviewEdge(edge.id(), { action: "reject", reviewer: "Planner", note: "Impact not supported." });
        const rejectedState = edge.data("relationship");
        edge.data("relationship", before);
        edge.data("truthClass", before.truthClass);
        const approved = api.reviewEdge(edge.id(), { action: "approve", reviewer: "Planner", note: "Schedule evidence confirmed." });
        return { before, rejected, rejectedState, approved, after: edge.data("relationship") };
    });

    expect(result.before.truthClass).toBe("inferred");
    expect(result.rejectedState.truthClass).toBe("inferred");
    expect(result.rejectedState.review.status).toBe("rejected");
    expect(result.approved.ok).toBe(true);
    expect(result.after.truthClass).toBe("governed");
    expect(result.after.review.status).toBe("approved");
    expect(result.after.review.reviewedBy).toBe("Planner");
    expect(result.after.audit).toHaveLength(1);
});

test("APS Relationships adapter maps native and soft-deleted references into canonical edges", async ({ page }) => {
    await bootPage(page);
    await page.waitForFunction(() => !!window.ONEXUS_APS_RELATIONSHIPS, { timeout: 10_000 });
    const payload = await page.evaluate(async () => (await fetch("/samples/json/autodesk-aps-relationships-feasibility.json")).json());
    const graph = await page.evaluate(data => window.ONEXUS_APS_RELATIONSHIPS.mapPayload(data), payload);

    expect(graph.elements.nodes).toHaveLength(3);
    expect(graph.elements.edges).toHaveLength(2);
    expect(graph.meta.aps.syncToken).toBe("demo-sync-002");

    const active = graph.elements.edges.find(edge => edge.data.id.includes("issue-sheet"));
    const deleted = graph.elements.edges.find(edge => edge.data.id.includes("rfi-sheet"));
    expect(active.data.relationship.truthClass).toBe("source-native");
    expect(active.data.relationship.source.system).toBe("Autodesk APS Relationships API");
    expect(deleted.data.relationship.truthClass).toBe("historical");
    expect(deleted.data.relationship.lifecycle.deleted).toBe(true);
    expect(deleted.data.deletedReference).toBe(true);
});

test("APS Relationships fetch client follows explicit next links without handling OAuth tokens", async ({ page }) => {
    await bootPage(page);
    await page.waitForFunction(() => !!window.ONEXUS_APS_RELATIONSHIPS, { timeout: 10_000 });
    const result = await page.evaluate(async () => {
        const calls = [];
        const pages = {
            "https://proxy.test/page-1": {
                results: [{ id: "one", entities: [
                    { domain: "issues", type: "issue", id: "I-1" },
                    { domain: "docs", type: "sheet", id: "S-1" },
                ] }],
                links: { next: { href: "https://proxy.test/page-2" } },
            },
            "https://proxy.test/page-2": {
                syncToken: "sync-final",
                results: [{ id: "two", entities: [
                    { domain: "rfi", type: "rfi", id: "R-1" },
                    { domain: "docs", type: "sheet", id: "S-1" },
                ] }],
            },
        };
        const graph = await window.ONEXUS_APS_RELATIONSHIPS.fetchAll({
            url: "https://proxy.test/page-1",
            projectId: "b.test",
            fetchImpl: async url => {
                calls.push(url);
                return { ok: true, status: 200, json: async () => pages[url] };
            },
        });
        return { calls, graph };
    });

    expect(result.calls).toEqual(["https://proxy.test/page-1", "https://proxy.test/page-2"]);
    expect(result.graph.meta.aps.pageCount).toBe(2);
    expect(result.graph.meta.aps.syncToken).toBe("sync-final");
    expect(result.graph.elements.nodes).toHaveLength(3);
    expect(result.graph.elements.edges).toHaveLength(2);
});

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

    const filteredOut = await page.evaluate(() => window.cy.nodes(".onx-hide-filter").length);
    expect(filteredOut).toBeGreaterThan(0); // filter marked non-matching nodes hidden

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
    }, "/samples/json/onexus_smart_access_flagship.json");
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
    expect(colorsByType.requires).toBeTruthy();
    expect(colorsByType.blocks).not.toBe(colorsByType.requires);
    expect(colorsByType.blocks).not.toBe("rgb(153,153,153)"); // not the old flat-gray fallback
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
    }, "/samples/json/onexus_smart_access_flagship.json");
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
    expect(arrowsByType.requires).toBe("triangle");

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
