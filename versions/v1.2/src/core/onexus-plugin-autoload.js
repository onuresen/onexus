/* =========================================================
 ONEXUS — Plugin Autoloader (manifest-based)
 - Loads plugin scripts listed in /src/plugins/manifest.json
 - Optional filtering via window.ONEXUS_PLUGIN_FILTER = "-importer.js"
 - Loads sequentially to preserve predictable registration order
========================================================= */
(function () {
    async function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false; // keep order
            s.onload = resolve;
            s.onerror = () => reject(new Error("Failed to load: " + src));
            document.head.appendChild(s);
        });
    }

    async function autoload() {
        const base = "./src/plugins/";
        const manifestUrl = base + "manifest.json";

        let list = [];
        try {
            const res = await fetch(manifestUrl, { cache: "no-cache" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const json = await res.json();
            list = Array.isArray(json?.plugins) ? json.plugins : [];
        } catch (e) {
            console.warn("[ONEXUS] Plugin manifest load failed:", e);
            return;
        }

        // Optional: enable suffix filter via window.ONEXUS_PLUGIN_FILTER = "-importer.js"
        const suffix = String(window.ONEXUS_PLUGIN_FILTER ?? "").trim();
        const files = list
            .map((x) => String(x ?? "").trim())
            .filter(Boolean)
            .filter((f) => !suffix || f.endsWith(suffix))
            .map((f) => base + f);

        for (const src of files) {
            try {
                await loadScript(src);
                console.debug("[ONEXUS] Plugin loaded:", src);
            } catch (e) {
                console.error("[ONEXUS] Plugin failed:", src, e);
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => autoload());
    } else {
        autoload();
    }
})();