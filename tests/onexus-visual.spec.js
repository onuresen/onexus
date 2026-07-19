const { test, expect } = require("playwright/test");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const FLAGSHIP = "/samples/json/onexus_smart_access_flagship.json";
const VISUAL_OPTIONS = { animations: "disabled", maxDiffPixelRatio: 0.025 };

async function loadFlagship(page) {
    await page.goto(`${BASE}/index.html?ci=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.cy && window.onexusLoadGraph);
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(async (path) => {
        const graph = await (await fetch(path)).json();
        const applyLayout = window.applyLayout;
        window.applyLayout = () => { };
        try { window.onexusLoadGraph(graph); }
        finally { window.applyLayout = applyLayout; }
    }, FLAGSHIP);
    await page.waitForFunction(() => window.cy.nodes().length === 40);
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        window.ONEXUS_SCENARIOS?.hideChooser?.();
        const nodes = window.cy.nodes().sort((a, b) => a.id().localeCompare(b.id()));
        nodes.forEach((node, index) => node.position({
            x: (index % 8) * 130,
            y: Math.floor(index / 8) * 110,
        }));
        window.cy.zoom(0.65);
        window.cy.pan({ x: 260, y: 230 });
    });
    await page.waitForTimeout(300);
}

test("flagship graph remains visually stable in light and dark themes", async ({ page }) => {
    await loadFlagship(page);
    const themeOptions = {
        ...VISUAL_OPTIONS,
        mask: [page.locator("#cy canvas"), page.locator("#minimap canvas")],
        maskColor: "#94a3b8",
    };
    await page.evaluate(() => window.applyTheme?.("light"));
    await expect(page).toHaveScreenshot("flagship-light.png", themeOptions);

    await page.evaluate(() => window.applyTheme?.("dark"));
    await expect(page).toHaveScreenshot("flagship-dark.png", themeOptions);
});

test("flagship story chooser remains visually stable", async ({ page }) => {
    await loadFlagship(page);
    await page.evaluate(() => {
        window.applyTheme?.("light");
        window.ONEXUS_SCENARIOS?.showChooser?.();
    });
    await expect(page.locator("#onx-story-chooser")).toBeVisible();
    await expect(page).toHaveScreenshot("flagship-story-chooser.png", VISUAL_OPTIONS);
});

test("Sankey and Chord presentation surfaces remain visually stable", async ({ page }) => {
    await loadFlagship(page);
    await page.selectOption("#layoutSelect", "sankey");
    await page.waitForFunction(() => document.querySelectorAll("#onxSankeySvg path, #onxSankeySvg rect").length > 0);
    await expect(page).toHaveScreenshot("flagship-sankey.png", VISUAL_OPTIONS);

    await page.selectOption("#layoutSelect", "chord");
    await page.waitForFunction(() => document.querySelectorAll("#onxChordSvg path").length > 0);
    await expect(page).toHaveScreenshot("flagship-chord.png", VISUAL_OPTIONS);
});
