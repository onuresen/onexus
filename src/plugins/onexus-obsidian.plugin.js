/* =========================================================
 ONEXUS Plugin — Obsidian Vault (Markdown) Importer
 ---------------------------------------------------------
 - User selects a folder (vault root)
 - Recursively reads all .md files
 - Builds a knowledge graph:
     Node  = Markdown note
     Edge  = [[wikilink]]
     Node  = #tag (shared, one per unique tag)
     Edge  = Tagged (note → tag)
 - Extracts:
     - Wiki links (basename AND full-path resolution)
     - #tags (as cluster nodes)
     - YAML frontmatter: title, aliases, status, updated, tags
     - First paragraph snippet (shown in details panel)
 - Category assigned from vault folder structure:
     projects/ → Project / Project-Detail
     concepts/ → Concept / Concept-Sub
     industry/ → Industry   work/ → Work
     daily/    → Daily      personal/ → Personal
     frameworks/ → Framework  research/ → Research
     ideas/    → Ideas      (root) → Navigation
 - Details panel shows: snippet, status badge, updated, tags, Open in Obsidian
 ========================================================= */

(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    /* -----------------------------------------
     Utilities
    ----------------------------------------- */

    function idSafe(s) {
        return String(s ?? "").replace(/[^\w\-:.\/]+/g, "_");
    }

    /* -----------------------------------------
     Category from vault folder path
     Mirrors the logic in generate-vault-graph.py
    ----------------------------------------- */

    function getCategoryFromPath(relPath) {
        const parts = relPath.replace(/\.md$/i, "").split("/");
        if (parts.length === 1) return "Navigation";
        const folder = parts[0].toLowerCase();
        const depth  = parts.length - 1;
        const map = {
            projects:   depth === 1 ? "Project" : "Project-Detail",
            concepts:   depth === 1 ? "Concept"  : "Concept-Sub",
            industry:   "Industry",
            work:       "Work",
            daily:      "Daily",
            personal:   "Personal",
            frameworks: "Framework",
            research:   "Research",
            ideas:      "Ideas",
        };
        return map[folder] ?? "Other";
    }

    // Directories to skip — Obsidian internals + common non-content folders
    const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash", ".DS_Store"]);

    async function readVaultDirectory(dirHandle, basePath = "") {
        // Collect all entries first (the async iteration itself is sequential per dir)
        const subdirHandles = [];
        const fileHandles   = [];

        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === "directory") {
                if (!SKIP_DIRS.has(name) && !name.startsWith(".")) {
                    subdirHandles.push({ handle, name });
                }
            } else if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
                fileHandles.push({ handle, path: basePath + name });
            }
        }

        // Parallelize: getFile() for all .md files + recurse all subdirs simultaneously
        const [files, ...subdirArrays] = await Promise.all([
            Promise.all(
                fileHandles.map(({ handle, path }) =>
                    handle.getFile().then(file => ({ file, path }))
                )
            ),
            ...subdirHandles.map(({ handle, name }) =>
                readVaultDirectory(handle, basePath + name + "/")
            ),
        ]);

        return [...files, ...subdirArrays.flat()];
    }

    function parseMarkdown(text) {
        const links = [];
        const tags = new Set();
        const aliases = [];
        let snippet = "";
        let fmTitle   = "";
        let fmStatus  = "";
        let fmUpdated = "";

        // Strip YAML frontmatter first, keep remainder as body for snippet
        let body = text;
        if (text.startsWith("---")) {
            const fmEnd = text.indexOf("---", 3);
            if (fmEnd !== -1) {
                const fm = text.slice(3, fmEnd);

                // title
                const titleM = fm.match(/^title:\s*['""]?(.+?)['""]?\s*$/m);
                if (titleM) fmTitle = titleM[1].trim();

                // status
                const statusM = fm.match(/^status:\s*['""]?(.+?)['""]?\s*$/m);
                if (statusM) fmStatus = statusM[1].trim();

                // updated
                const updatedM = fm.match(/^updated:\s*['""]?(.+?)['""]?\s*$/m);
                if (updatedM) fmUpdated = updatedM[1].trim();

                // aliases — inline list: "aliases: a, b" or YAML list block
                const aliasLine = fm.match(/^aliases:\s*(.+)/im);
                if (aliasLine) {
                    aliasLine[1]
                        .split(",")
                        .map(a => a.trim().replace(/^['""\[\]]|['""\[\]]$/g, ""))
                        .filter(Boolean)
                        .forEach(a => aliases.push(a));
                }

                // tags in frontmatter: "tags: [a, b, c]" or list block
                const tagLine = fm.match(/^tags:\s*\[([^\]]+)\]/im);
                if (tagLine) {
                    tagLine[1].split(",").map(t => t.trim().replace(/['"]/g, ""))
                        .filter(Boolean).forEach(t => tags.add("#" + t));
                } else {
                    // block-style tags list
                    const tagBlock = fm.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/im);
                    if (tagBlock) {
                        tagBlock[1].split("\n")
                            .map(l => l.replace(/^\s*-\s*/, "").trim().replace(/['"]/g, ""))
                            .filter(Boolean)
                            .forEach(t => tags.add("#" + t));
                    }
                }

                body = text.slice(fmEnd + 3);
            }
        }

        // [[Wiki Links]] — scan full text including frontmatter body
        const linkRe = /\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g;
        let m;
        while ((m = linkRe.exec(text))) {
            links.push(m[1].trim());
        }

        // #tags in body (hashtag style)
        const tagRe = /(^|\s)#([\w/-]+)/g;
        while ((m = tagRe.exec(body))) {
            tags.add("#" + m[2]);
        }

        // First meaningful paragraph from body (strip markdown syntax for readability)
        const paras = body.split(/\n\n+/);
        for (const para of paras) {
            const clean = para
                .replace(/^#{1,6}\s+/gm, "")                              // headings
                .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)  // wikilinks → display text
                .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")                 // [text](url) → text
                .replace(/!\[.*?\]\([^\)]+\)/g, "")                       // images
                .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1")         // bold/italic/code spans
                .replace(/~~([^~]+)~~/g, "$1")                            // strikethrough
                .replace(/^\s*[-*+]\s+/gm, "")                            // list bullets
                .replace(/^\s*\d+\.\s+/gm, "")                            // ordered list
                .trim();
            if (clean.length > 20) {
                snippet = clean.length > 220 ? clean.slice(0, 220) + "…" : clean;
                break;
            }
        }

        return { links, tags: Array.from(tags), aliases, snippet, fmTitle, fmStatus, fmUpdated };
    }

    /* -----------------------------------------
     Graph Builder
    ----------------------------------------- */

    async function buildGraphFromVault(vaultName, mdFiles) {
        const nodes = [];
        const edges = [];
        const edgeSet = new Set();

        // basename → id  (first match wins, for [[ShortName]] style links)
        const noteIdByBasename = new Map();
        // full relpath (no ext, forward slashes) → id  (for [[projects/ONES]] style links)
        const noteIdByRelpath  = new Map();
        const tagNodeById      = new Map();

        // 1. Create note nodes — first pass (no file reads yet)
        for (const { path } of mdFiles) {
            // Normalise to forward slashes (Windows may give backslashes)
            const normPath = path.replace(/\\/g, "/");
            const id       = idSafe(normPath.replace(/\.md$/i, ""));
            const basename = normPath.split("/").pop().replace(/\.md$/i, "");
            const relPath  = normPath.replace(/\.md$/i, "");   // e.g. "projects/ONES-Revit-Plugin"

            noteIdByBasename.set(basename, id);
            noteIdByRelpath.set(relPath,   id);

            const category = getCategoryFromPath(normPath);

            nodes.push({
                data: {
                    id,
                    nodeType: "Note",
                    category,
                    displayLabel: basename,  // overwritten below after frontmatter read
                    obsidian: { vault: vaultName, path: normPath, relPath }
                }
            });
        }

        // Build lookup map for O(1) node access
        const nodeById = new Map(nodes.map(n => [n.data.id, n]));

        // 2. Parse content — second pass, all files in parallel
        // The File System Access API's overhead is per-call, not per-byte.
        // Reading all files simultaneously saturates the available I/O and avoids
        // the sequential await-per-file penalty.
        window.showTransientMessage?.(`Reading ${mdFiles.length} notes…`, 120_000);

        const allTexts = await Promise.all(
            mdFiles.map(({ file, path }) =>
                file.text().then(text => ({ text, path }))
            )
        );

        for (const { text, path } of allTexts) {
            const normPath = path.replace(/\\/g, "/");
            const srcId  = idSafe(normPath.replace(/\.md$/i, ""));
            const parsed = parseMarkdown(text);

            // Enrich node with frontmatter + snippet
            const node = nodeById.get(srcId);
            if (node) {
                if (parsed.fmTitle) node.data.displayLabel = parsed.fmTitle;
                node.data.obsidian.tags    = parsed.tags;
                node.data.obsidian.aliases = parsed.aliases;
                node.data.obsidian.snippet = parsed.snippet;
                node.data.obsidian.status  = parsed.fmStatus;
                node.data.obsidian.updated = parsed.fmUpdated;
                // Expose status at top level for ONEXUS style rules
                if (parsed.fmStatus)  node.data.status  = parsed.fmStatus;
                if (parsed.fmUpdated) node.data.updated = parsed.fmUpdated;
            }

            // Wikilink edges — try full relpath first, then basename
            for (const linkRaw of parsed.links) {
                const norm = linkRaw.replace(/\\/g, "/").trim();
                const tgtId =
                    noteIdByRelpath.get(norm) ??
                    noteIdByBasename.get(norm.split("/").pop());

                if (!tgtId || tgtId === srcId) continue;

                const edgeKey = `${srcId}>>>${tgtId}`;
                if (edgeSet.has(edgeKey)) continue;
                edgeSet.add(edgeKey);

                edges.push({
                    data: {
                        id: idSafe(`e_${srcId}_LinksTo_${tgtId}`),
                        type: "LinksTo",
                        dimension: "Knowledge",
                        directional: true,
                        source: srcId,
                        target: tgtId,
                        confidence: "Explicit"
                    }
                });
            }

            // Tag nodes + Tagged edges
            for (const tag of parsed.tags) {
                const tagId = "tag_" + idSafe(tag);

                if (!tagNodeById.has(tagId)) {
                    const tagNode = {
                        data: {
                            id: tagId,
                            nodeType: "Tag",
                            category: "Tag",
                            displayLabel: tag,
                            obsidian: { vault: vaultName, isTag: true }
                        }
                    };
                    tagNodeById.set(tagId, tagNode);
                    nodes.push(tagNode);
                }

                const tagEdgeKey = `${srcId}>>>tag:${tagId}`;
                if (!edgeSet.has(tagEdgeKey)) {
                    edgeSet.add(tagEdgeKey);
                    edges.push({
                        data: {
                            id: idSafe(`e_${srcId}_Tagged_${tagId}`),
                            type: "Tagged",
                            dimension: "Knowledge",
                            directional: false,
                            source: srcId,
                            target: tagId
                        }
                    });
                }
            }
        }

        return {
            elements: { nodes, edges },
            meta: {
                schema: "onexus",
                importer: "obsidian-md",
                importedAt: new Date().toISOString(),
                sourceKind: "import",
                vault: vaultName,
                nodeCount: nodes.length,
                edgeCount: edges.length
            }
        };
    }

    /* -----------------------------------------
     IndexedDB Graph Cache
     First load builds from disk (slow). Subsequent loads
     read from IDB (instant). A "Reload from disk" option
     is offered when cache exists.
    ----------------------------------------- */

    const IDB_NAME  = "onexus-obsidian-cache";
    const IDB_VER   = 1;
    const IDB_STORE = "graphs";

    function openIDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = e =>
                e.target.result.createObjectStore(IDB_STORE);
            req.onsuccess  = e => resolve(e.target.result);
            req.onerror    = ()  => reject(req.error);
        });
    }

    async function loadCachedGraph(key) {
        try {
            const db = await openIDB();
            return await new Promise((resolve) => {
                const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror   = () => resolve(null);
            });
        } catch { return null; }
    }

    async function saveCachedGraph(key, graph) {
        try {
            const db = await openIDB();
            await new Promise((resolve) => {
                const tx  = db.transaction(IDB_STORE, "readwrite");
                tx.objectStore(IDB_STORE).put({ graph, ts: Date.now() }, key);
                tx.oncomplete = resolve;
                tx.onerror    = resolve; // non-fatal
            });
        } catch { /* non-fatal */ }
    }

    function ageLabel(ts) {
        const mins = Math.round((Date.now() - ts) / 60_000);
        if (mins < 1)   return "just now";
        if (mins < 60)  return `${mins} min ago`;
        const hrs = Math.round(mins / 60);
        if (hrs  < 24)  return `${hrs} hr ago`;
        return `${Math.round(hrs / 24)} days ago`;
    }

    /* -----------------------------------------
     Importer Logic
    ----------------------------------------- */

    async function importObsidianVault() {
        if (typeof window.showDirectoryPicker !== "function") {
            alert("Directory picker is not supported in this browser.");
            return;
        }

        const dirHandle = await window.showDirectoryPicker();
        const cacheKey  = `vault:${dirHandle.name}`;

        // Offer cached graph if available — makes repeat loads instant
        const cached = await loadCachedGraph(cacheKey);
        if (cached?.graph && cached?.ts) {
            const age = ageLabel(cached.ts);
            const useCache = confirm(
                `Cached vault graph available (built ${age}).\n\n` +
                `OK     → Load from cache  (instant)\n` +
                `Cancel → Rebuild from disk (10–30 s)`
            );
            if (useCache) {
                window.showTransientMessage?.(`Loaded from cache (${age})`, 3000);
                window.onexusLoadGraph?.(cached.graph);
                setTimeout(() => window.applyColorMode?.("vault_knowledge"), 120);
                return;
            }
        }

        window.showTransientMessage?.("Scanning vault folder…", 120_000);
        const files = await readVaultDirectory(dirHandle);
        if (!files.length) {
            alert("No Markdown (.md) files found.");
            return;
        }

        const graph = await buildGraphFromVault(dirHandle.name, files);

        // Save to cache before loading (non-blocking)
        saveCachedGraph(cacheKey, graph);

        window.onexusLoadGraph?.(graph);

        // Switch to vault color mode after the graph loads
        // (small delay ensures applyColorMode runs after buildStyle)
        setTimeout(() => window.applyColorMode?.("vault_knowledge"), 120);
    }

    /* -----------------------------------------
     Details Panel Extension
    ----------------------------------------- */

    function extendDetailsPanel() {
        if (typeof window.updateDetailsForNode !== "function") return;
        if (window.__onxObsidianDetailsPatched) return;
        window.__onxObsidianDetailsPatched = true;

        const esc = (s) => {
            const fn = window.ONEXUS?.util?.escapeHtml;
            return typeof fn === "function" ? fn(s) : String(s ?? "");
        };

        const original = window.updateDetailsForNode;
        window.updateDetailsForNode = function (node) {
            original(node);

            const d = node?.data?.();
            if (!d || !d.obsidian) return;

            // Prefer the float body; fall back to the outer container
            const container =
                document.getElementById("onxFloatDetailsBody") ||
                document.getElementById("onxFloatDetails");
            if (!container) return;

            const vault   = d.obsidian.vault;
            const path    = d.obsidian.path;
            const snippet = d.obsidian.snippet;
            const tags    = Array.isArray(d.obsidian.tags) ? d.obsidian.tags : [];
            const isTag   = !!d.obsidian.isTag;
            const status  = d.obsidian.status  || "";
            const updated = d.obsidian.updated  || "";
            const category = d.category || "";

            const block = document.createElement("div");
            block.style.cssText = "margin-top:8px;border-top:1px solid var(--stroke,#e5e7eb);padding-top:8px;";

            // Meta row: category chip + status badge + updated date
            if (!isTag && (category || status || updated)) {
                const metaRow = document.createElement("div");
                metaRow.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:6px;";

                const statusColors = {
                    active:    { bg:"#dcfce7", color:"#166534" },
                    planning:  { bg:"#dbeafe", color:"#1e40af" },
                    paused:    { bg:"#fef9c3", color:"#854d0e" },
                    done:      { bg:"#f3f4f6", color:"#6b7280" },
                    shipped:   { bg:"#f3f4f6", color:"#6b7280" },
                    pilot:     { bg:"#ede9fe", color:"#6d28d9" },
                };

                if (category) {
                    const catChip = document.createElement("span");
                    catChip.style.cssText =
                        "font-size:10px;padding:1px 6px;border-radius:9999px;" +
                        "background:#e0e7ff;color:#3730a3;font-weight:600;letter-spacing:.03em;";
                    catChip.textContent = esc(category);
                    metaRow.appendChild(catChip);
                }

                if (status) {
                    const sc = statusColors[status.toLowerCase()] || { bg:"#f3f4f6", color:"#374151" };
                    const badge = document.createElement("span");
                    badge.style.cssText =
                        `font-size:10px;padding:1px 6px;border-radius:9999px;font-weight:600;` +
                        `background:${sc.bg};color:${sc.color};`;
                    badge.textContent = esc(status);
                    metaRow.appendChild(badge);
                }

                if (updated) {
                    const upd = document.createElement("span");
                    upd.style.cssText = "font-size:10px;color:var(--text-muted,#9ca3af);margin-left:auto;";
                    upd.textContent = "↻ " + esc(updated);
                    metaRow.appendChild(upd);
                }

                block.appendChild(metaRow);
            }

            // Content snippet (notes only, not tag nodes)
            if (!isTag && snippet) {
                const snipEl = document.createElement("p");
                snipEl.style.cssText = "font-size:12px;color:var(--text-muted,#6b7280);line-height:1.5;margin:0 0 6px;";
                snipEl.textContent = snippet;
                block.appendChild(snipEl);
            }

            // Tag chips (de-dup, skip system/meta tags)
            const displayTags = tags
                .filter(t => !["system","map","moc","meta"].includes(t.slice(1)))
                .slice(0, 8);
            if (!isTag && displayTags.length) {
                const tagWrap = document.createElement("div");
                tagWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;";
                displayTags.forEach(tag => {
                    const chip = document.createElement("span");
                    chip.style.cssText =
                        "font-size:11px;padding:2px 6px;border-radius:9999px;" +
                        "background:var(--bg-soft,#f3f4f6);color:var(--text-muted,#6b7280);";
                    chip.textContent = esc(tag);
                    tagWrap.appendChild(chip);
                });
                block.appendChild(tagWrap);
            }

            // "Open in Obsidian" deep link (not applicable for tag nodes)
            if (!isTag && vault && path) {
                const uri =
                    "obsidian://open?vault=" + encodeURIComponent(vault) +
                    "&file=" + encodeURIComponent(path.replace(/\.md$/i, ""));

                const link = document.createElement("a");
                link.href = uri;
                link.style.cssText = "font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;";
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "Open in Obsidian →";
                block.appendChild(link);
            }

            container.appendChild(block);
        };
    }

    /* -----------------------------------------
     Vault / Knowledge Color Mode
     Registered once when the plugin loads.
     Appears in the color-mode selector as "Vault / Knowledge".
    ----------------------------------------- */

    const VAULT_COLORS = {
        "Project":        "#4338ca",   // indigo     — active projects
        "Project-Detail": "#818cf8",   // light indigo — sub-notes
        "Concept":        "#d97706",   // amber       — cross-cutting ideas
        "Concept-Sub":    "#fbbf24",   // light amber
        "Industry":       "#059669",   // emerald     — domain knowledge
        "Work":           "#0d9488",   // teal        — Obayashi context
        "Daily":          "#64748b",   // slate       — time-dimension logs
        "Navigation":     "#475569",   // blue-grey   — MOC / index notes
        "Personal":       "#e11d48",   // rose
        "Research":       "#7c3aed",   // violet
        "Ideas":          "#ea580c",   // orange
        "Framework":      "#0891b2",   // cyan
        "Tag":            "#94a3b8",   // light grey  — always small diamonds
        "Other":          "#6b7280",   // grey
    };

    function registerVaultColorMode() {
        window.ONEXUS?.style?.registerColorMode?.("vault_knowledge", {
            label: "Vault / Knowledge",
            nodeColorFn: (ele) => VAULT_COLORS[ele.data("category")] ?? "#6b7280",
        });
    }

    // Register immediately if ONEXUS.style is ready, else defer
    if (typeof window.ONEXUS?.style?.registerColorMode === "function") {
        registerVaultColorMode();
    } else {
        setTimeout(registerVaultColorMode, 200);
    }

    /* -----------------------------------------
     Plugin Registration
    ----------------------------------------- */

    ONX.registerPlugin({
        id: "obsidian-md",
        title: "Obsidian Vault (Markdown)",
        register(api) {
            // Importer registration (manual trigger)
            api.registerImporter({
                id: "obsidian-md",
                label: "Obsidian Vault (Markdown)",
                priority: 96,
                extensions: ["md"],
                acceptMultiple: false,
                canHandleFiles: async () => false, // directory-based only
                importFiles: async () => {
                    await importObsidianVault();
                }
            });

            // Patch details panel
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", extendDetailsPanel);
            } else {
                extendDetailsPanel();
            }
        }
    });

})();
