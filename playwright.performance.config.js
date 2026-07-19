/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
    testDir: "./tests",
    testMatch: "onexus-performance.spec.js",
    timeout: 120_000,
    retries: 0,
    workers: 1,
    use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1400, height: 900 },
    },
};
