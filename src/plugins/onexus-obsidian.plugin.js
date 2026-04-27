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
     - Wiki links
     - #tags (as cluster nodes)
     - YAML frontmatter aliases
     - First paragraph snippet (shown in details panel)
 - Adds "Open in Obsidian" action to node details
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

    async function readVaultDirectory(dirHandle, out = [], basePath = "") {
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === "directory") {
                await readVaultDirectory(handle, out, basePath + name + "/");
            } else if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
                const file = await handle.getFile();
                out.push({ file, path: basePath + name });
            }
        }
        return out;
    }

    function parseMarkdown(text) {
        const links = [];
        const tags = new Set();
        const aliases = [];
        let snippet = "";

        // Strip YAML frontmatter first, keep remainder as body for snippet
        let body = text;
        if (text.startsWith("---")) {
            const fmEnd = text.indexOf("---", 3);
            if (fmEnd !== -1) {
                const fm = text.slice(3, fmEnd);
                const aliasLine = fm.match(/aliases:\s*(.+)/i);
                if (aliasLine) {
                    aliasLine[1]
                        .split(",")
                        .map(a => a.trim())
                        .filter(Boolean)
                        .forEach(a => aliases.push(a));
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

        // #tags
        const tagRe = /(^|\s)#([\w/-]+)/g;
        while ((m = tagRe.exec(text))) {
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

        return { links, tags: Array.from(tags), aliases, snippet };
    }

    /* -----------------------------------------
     Graph Builder
    ----------------------------------------- */

    async function buildGraphFromVault(vaultName, mdFiles) {
        const nodes = [];
        const edges = [];
        const noteIdByName = new Map();
        const tagNodeById = new Map();

        // 1. Create note nodes
        for (const { path } of mdFiles) {
            const id = idSafe(path.replace(/\.md$/i, ""));
            const name = path.split("/").pop().replace(/\.md$/i, "");

            noteIdByName.set(name, id);

            nodes.push({
                data: {
                    id,
                    nodeType: "Note",
                    category: "Obsidian",
                    displayLabel: name,
                    obsidian: { vault: vaultName, path }
                }
            });
        }

        // Build lookup map for O(1) node access
        const nodeById = new Map(nodes.map(n => [n.data.id, n]));

        // 2. Parse content, build wikilink edges, tag nodes, and tag edges
        for (const { file, path } of mdFiles) {
            const text = await file.text();
            const srcId = idSafe(path.replace(/\.md$/i, ""));
            const parsed = parseMarkdown(text);

            const node = nodeById.get(srcId);
            if (node) {
                node.data.obsidian.tags = parsed.tags;
                node.data.obsidian.aliases = parsed.aliases;
                node.data.obsidian.snippet = parsed.snippet;
            }

            // Wikilink edges
            for (const linkName of parsed.links) {
                const tgtId = noteIdByName.get(linkName);
                if (!tgtId) continue;
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

        return {
            elements: { nodes, edges },
            meta: {
                schema: "onexus",
                importer: "obsidian-md",
                importedAt: new Date().toISOString(),
                sourceKind: "import",
                vault: vaultName
            }
        };
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
        const files = await readVaultDirectory(dirHandle);
        if (!files.length) {
            alert("No Markdown (.md) files found.");
            return;
        }

        const graph = await buildGraphFromVault(dirHandle.name, files);
        window.onexusLoadGraph?.(graph);
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

            const vault = d.obsidian.vault;
            const path = d.obsidian.path;
            const snippet = d.obsidian.snippet;
            const tags = Array.isArray(d.obsidian.tags) ? d.obsidian.tags : [];
            const isTag = !!d.obsidian.isTag;

            const block = document.createElement("div");
            block.style.cssText = "margin-top:8px;border-top:1px solid var(--stroke,#e5e7eb);padding-top:8px;";

            // Content snippet (notes only, not tag nodes)
            if (!isTag && snippet) {
                const snipEl = document.createElement("p");
                snipEl.style.cssText = "font-size:12px;color:var(--text-muted,#6b7280);line-height:1.5;margin:0 0 6px;";
                snipEl.textContent = snippet;
                block.appendChild(snipEl);
            }

            // Tag chips
            if (!isTag && tags.length) {
                const tagWrap = document.createElement("div");
                tagWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;";
                tags.forEach(tag => {
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
                    "&file=" + encodeURIComponent(path);

                const link = document.createElement("a");
                link.href = uri;
                link.style.cssText = "font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;";
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "Open in Obsidian";
                block.appendChild(link);
            }

            container.appendChild(block);
        };
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
