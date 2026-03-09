/* =========================================================
ONEXUS – Dev Export Snapshot (single-file bundle for sharing)
- Collects same-origin JS+CSS currently loaded in the page
- Fetches file contents and exports ONE merged text file
- Also exports a JSON manifest (optional)
- Safe: does not touch window.cy
Limitations:
- Only same-origin URLs (CORS rules apply)
- Only files referenced via <script src> and <link rel="stylesheet" href>
========================================================= */
(function () {
    const NS = (window.ONEXUS_DEV_SNAPSHOT = window.ONEXUS_DEV_SNAPSHOT || {});
    const NOW = () => new Date().toISOString();

    function isSameOrigin(urlStr) {
        try {
            const u = new URL(urlStr, location.href);
            return u.origin === location.origin;
        } catch {
            return false;
        }
    }

    function toAbs(urlStr) {
        try { return new URL(urlStr, location.href).href; }
        catch { return urlStr; }
    }

    function niceName(urlStr) {
        try {
            const u = new URL(urlStr, location.href);
            const p = u.pathname || "";
            return p.split("/").filter(Boolean).slice(-1)[0] || "unknown";
        } catch {
            const p = String(urlStr || "");
            return p.split("/").filter(Boolean).slice(-1)[0] || "unknown";
        }
    }

    function download(filename, text, mime = "text/plain;charset=utf-8") {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 800);
    }

    function listAssets() {
        const scripts = Array.from(document.scripts || [])
            .map(s => s.getAttribute("src"))
            .filter(Boolean)
            .map(s => s.trim())
            .filter(Boolean)
            .map(toAbs);

        const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]') || [])
            .map(l => l.getAttribute("href"))
            .filter(Boolean)
            .map(h => h.trim())
            .filter(Boolean)
            .map(toAbs);

        // only same-origin (avoid CDN libs)
        const js = scripts.filter(isSameOrigin);
        const css = styles.filter(isSameOrigin);

        // de-dupe preserving order
        const dedupe = (arr) => {
            const seen = new Set();
            const out = [];
            for (const x of arr) {
                if (seen.has(x)) continue;
                seen.add(x);
                out.push(x);
            }
            return out;
        };

        return {
            jsAll: dedupe(scripts),
            cssAll: dedupe(styles),
            js: dedupe(js),
            css: dedupe(css),
        };
    }

    async function fetchText(url) {
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, text };
    }

    function makeHeader(manifest) {
        return [
            "===== ONEXUS SOURCE SNAPSHOT =====",
            `createdAt: ${manifest.createdAt}`,
            `page: ${manifest.page}`,
            `sameOriginJS: ${manifest.assets.js.length}`,
            `sameOriginCSS: ${manifest.assets.css.length}`,
            `skippedJS(CDN/otherOrigin): ${manifest.assets.jsAll.length - manifest.assets.js.length}`,
            `skippedCSS(CDN/otherOrigin): ${manifest.assets.cssAll.length - manifest.assets.css.length}`,
            "",
            "---- MANIFEST (JSON) ----",
            JSON.stringify(manifest, null, 2),
            "",
            "---- FILES (BEGIN/END blocks) ----",
            "",
        ].join("\n");
    }

    function block(path, content) {
        return [
            `\n//// BEGIN FILE: ${path}`,
            content,
            `//// END FILE: ${path}\n`,
        ].join("\n");
    }

    // Public: build snapshot object (manifest + blocks)
    NS.build = async function build(opts = {}) {
        const assets = listAssets();
        const manifest = {
            schema: "onexus/dev-snapshot",
            createdAt: NOW(),
            page: location.href,
            opts: {
                includeCss: opts.includeCss !== false,
                includeJs: opts.includeJs !== false,
                includeAllSameOrigin: true,
            },
            assets,
            results: [],
        };

        const targets = [];
        if (opts.includeJs !== false) targets.push(...assets.js);
        if (opts.includeCss !== false) targets.push(...assets.css);

        const files = [];
        for (const url of targets) {
            try {
                const r = await fetchText(url);
                const rel = (() => {
                    try {
                        const u = new URL(url, location.href);
                        return u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
                    } catch { return url; }
                })();
                manifest.results.push({
                    url,
                    path: rel,
                    name: niceName(url),
                    ok: r.ok,
                    status: r.status,
                    statusText: r.statusText,
                    bytes: r.text?.length ?? 0,
                });
                files.push({ path: rel, url, content: r.text ?? "" });
            } catch (e) {
                manifest.results.push({
                    url,
                    path: url,
                    name: niceName(url),
                    ok: false,
                    status: 0,
                    statusText: String(e?.message ?? e),
                    bytes: 0,
                });
                files.push({ path: url, url, content: `/* FETCH FAILED: ${String(e?.message ?? e)} */` });
            }
        }

        // stable order: by url order already preserved
        return { manifest, files };
    };

    // Public: export merged text
    NS.exportText = async function exportText(opts = {}) {
        const snap = await NS.build(opts);
        const header = makeHeader(snap.manifest);
        const merged =
            header +
            snap.files.map(f => block(f.path, f.content)).join("\n");

        const name = `onexus-source-snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
        download(name, merged, "text/plain;charset=utf-8");
        return snap;
    };

    // Public: export manifest JSON only
    NS.exportManifest = async function exportManifest(opts = {}) {
        const snap = await NS.build(opts);
        const name = `onexus-source-manifest_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        download(name, JSON.stringify(snap.manifest, null, 2), "application/json");
        return snap.manifest;
    };
})();