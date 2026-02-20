/* =========================================================
ONEXUS – Dev Export Src Tree (bundle ./src/** into ONE file)
- Prompts user to pick project root folder (File System Access API)
- Recursively reads ./src/** (all files)
- Exports ONE merged text bundle + JSON manifest
- Safe: does not touch window.cy
- Works even if running index via file:// (no fetch needed)
Requires: none
========================================================= */
(function () {
    const NS = (window.ONEXUS_DEV_SRCTREE = window.ONEXUS_DEV_SRCTREE || {});
    const NOW = () => new Date().toISOString();

    const TEXT_EXT = new Set([
        "js", "mjs", "cjs", "ts", "tsx", "jsx",
        "css", "html", "htm",
        "json", "md", "txt", "yml", "yaml", "xml", "svg",
        "csv", "tsv",
        "frag", "vert", "glsl",
        "bat", "ps1", "sh",
        "cs", "csproj", "sln",
        "py", "java", "kt", "go", "rs"
    ]);

    function download(filename, text, mime = "text/plain;charset=utf-8") {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 800);
    }

    function extOf(path) {
        const m = String(path).toLowerCase().match(/\.([a-z0-9]+)$/);
        return m ? m[1] : "";
    }

    function isTextFile(path) {
        const ext = extOf(path);
        return TEXT_EXT.has(ext);
    }

    function normalizePath(parts) {
        return parts.filter(Boolean).join("/").replace(/\/\/+/g, "/");
    }

    function block(path, content) {
        return `\n//// BEGIN FILE: ${path}\n${content}\n//// END FILE: ${path}\n`;
    }

    function makeBundleHeader(manifest) {
        return [
            "===== ONEXUS SRC TREE SNAPSHOT =====",
            `createdAt: ${manifest.createdAt}`,
            `root: ${manifest.rootName}`,
            `subdir: ${manifest.subdir}`,
            `includedFiles: ${manifest.counts.included}`,
            `skippedBinaryOrUnknown: ${manifest.counts.skipped}`,
            `totalFilesScanned: ${manifest.counts.total}`,
            "",
            "---- MANIFEST (JSON) ----",
            JSON.stringify(manifest, null, 2),
            "",
            "---- FILES (BEGIN/END blocks) ----",
            ""
        ].join("\n");
    }

    // --------- File System Access API path ---------
    async function readAllFromDirHandle(dirHandle, opts) {
        const {
            subdir = "src",
            includeBinary = false,
            includePatterns = null, // optional fn (path)=>boolean
            excludePatterns = null, // optional fn (path)=>boolean
            maxBytesPerFile = 2_500_000, // safety
        } = opts || {};

        // locate ./src folder inside picked root
        let srcHandle = null;
        try {
            srcHandle = await dirHandle.getDirectoryHandle(subdir, { create: false });
        } catch {
            throw new Error(`Folder "${subdir}" not found under selected root.`);
        }

        const files = [];
        const manifest = {
            schema: "onexus/dev-srctree",
            createdAt: NOW(),
            rootName: dirHandle.name || "(picked folder)",
            subdir,
            counts: { total: 0, included: 0, skipped: 0 },
            items: []
        };

        async function walk(currentHandle, relParts) {
            for await (const [name, handle] of currentHandle.entries()) {
                const relPath = normalizePath([...relParts, name]);
                if (handle.kind === "directory") {
                    await walk(handle, [...relParts, name]);
                    continue;
                }

                manifest.counts.total++;

                const allowByUser =
                    (typeof includePatterns === "function" ? includePatterns(relPath) : true) &&
                    (typeof excludePatterns === "function" ? !excludePatterns(relPath) : true);

                if (!allowByUser) {
                    manifest.counts.skipped++;
                    manifest.items.push({ path: relPath, kind: "file", included: false, reason: "filtered" });
                    continue;
                }

                const isText = isTextFile(relPath);
                if (!isText && !includeBinary) {
                    manifest.counts.skipped++;
                    manifest.items.push({ path: relPath, kind: "file", included: false, reason: "non-text" });
                    continue;
                }

                try {
                    const f = await handle.getFile();
                    if (f.size > maxBytesPerFile) {
                        manifest.counts.skipped++;
                        manifest.items.push({ path: relPath, kind: "file", included: false, reason: `too-large(${f.size})` });
                        continue;
                    }

                    let content = "";
                    if (isText) {
                        content = await f.text();
                    } else {
                        // binary included: base64
                        const buf = await f.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        let bin = "";
                        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                        content = `/* BASE64 BINARY: ${relPath} */\n` + btoa(bin);
                    }

                    files.push({ path: relPath, content });
                    manifest.counts.included++;
                    manifest.items.push({ path: relPath, kind: "file", included: true, bytes: content.length });
                } catch (e) {
                    manifest.counts.skipped++;
                    manifest.items.push({ path: relPath, kind: "file", included: false, reason: `read-failed: ${String(e?.message ?? e)}` });
                }
            }
        }

        await walk(srcHandle, [subdir]);
        return { manifest, files };
    }

    // --------- Fallback: <input webkitdirectory> ---------
    function pickDirectoryFallback() {
        return new Promise((resolve, reject) => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.multiple = true;
            inp.setAttribute("webkitdirectory", "");
            inp.style.display = "none";
            document.body.appendChild(inp);

            inp.addEventListener("change", async () => {
                try {
                    const list = Array.from(inp.files || []);
                    inp.remove();
                    if (!list.length) return reject(new Error("No files selected."));

                    // We only include ./src/** from the chosen directory set
                    // webkitRelativePath gives "root/sub/dir/file"
                    const subdir = "src";
                    const files = [];
                    const manifest = {
                        schema: "onexus/dev-srctree",
                        createdAt: NOW(),
                        rootName: "(webkitdirectory)",
                        subdir,
                        counts: { total: 0, included: 0, skipped: 0 },
                        items: []
                    };

                    for (const f of list) {
                        const rel = String(f.webkitRelativePath || f.name).replace(/\\/g, "/");
                        manifest.counts.total++;

                        // include only "/src/" paths
                        const idx = rel.indexOf("/src/");
                        const relPath = idx >= 0 ? rel.slice(idx + 1) : (rel.startsWith("src/") ? rel : null);
                        if (!relPath) {
                            manifest.counts.skipped++;
                            manifest.items.push({ path: rel, kind: "file", included: false, reason: "outside-src" });
                            continue;
                        }

                        if (!isTextFile(relPath)) {
                            manifest.counts.skipped++;
                            manifest.items.push({ path: relPath, kind: "file", included: false, reason: "non-text" });
                            continue;
                        }

                        const content = await f.text();
                        files.push({ path: relPath, content });
                        manifest.counts.included++;
                        manifest.items.push({ path: relPath, kind: "file", included: true, bytes: content.length });
                    }

                    resolve({ manifest, files });
                } catch (e) {
                    inp.remove();
                    reject(e);
                }
            });

            inp.click();
        });
    }

    // --------- Public API ---------
    NS.build = async function build(opts = {}) {
        const subdir = opts.subdir || "src";

        // Prefer File System Access API
        if (window.showDirectoryPicker) {
            const root = await window.showDirectoryPicker({ id: "onexus-src-export", mode: "read" });
            return readAllFromDirHandle(root, { ...opts, subdir });
        }

        // Fallback input
        return pickDirectoryFallback();
    };

    NS.exportBundle = async function exportBundle(opts = {}) {
        const snap = await NS.build(opts);
        const header = makeBundleHeader(snap.manifest);
        const merged = header + snap.files.map(f => block(f.path, f.content)).join("\n");

        const name = `onexus-src-bundle_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
        download(name, merged, "text/plain;charset=utf-8");
        return snap;
    };

    NS.exportManifest = async function exportManifest(opts = {}) {
        const snap = await NS.build(opts);
        const name = `onexus-src-manifest_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        download(name, JSON.stringify(snap.manifest, null, 2), "application/json");
        return snap.manifest;
    };
})();