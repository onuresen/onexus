/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
    testDir: "./tests",
    timeout: 60_000,
    retries: 0,
    use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1400, height: 900 }
    }
};