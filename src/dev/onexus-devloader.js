/* =========================================================
 ONEXUS – Dev Loader (query-gated)
 - Loads dev-only scripts only if URL has ?dev=1 or ?ci=1
 - Prevents GitHub Pages users from loading dev overlays by default
========================================================= */
(function () {
    const url = new URL(location.href);
    const dev = url.searchParams.get("dev") === "1";
    const ci = url.searchParams.get("ci") === "1";

    if (!dev && !ci) return;

    const list = [
        "./src/dev/onexus-audit.runtime.js",
        "./src/dev/onexus-audit.hooks.js",
        "./src/dev/onexus-devgraph.common.js",
        "./src/dev/onexus-depgraph.js",
        "./src/dev/onexus-devgraph.combine.js",
        "./src/dev/onexus-dev.exportSrcTree.js",
        "./src/dev/onexus-dev.exportSnapshot.js",
        "./src/dev/onexus-devtools.bindDepGraphButton.js",
        "./src/dev/onexus-selftest.js"
    ];

    function load(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Failed to load: " + src));
            document.head.appendChild(s);
        });
    }

    (async () => {
        for (const src of list) {
            try { await load(src); }
            catch (e) { console.warn("[ONEXUS devloader] " + e.message); }
        }
        console.debug("[ONEXUS devloader] dev tools loaded:", list.length);
    })();
})();