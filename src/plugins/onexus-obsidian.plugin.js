/* =========================================================
 ONEXUS Plugin — Obsidian Vault (Markdown) Importer
 ---------------------------------------------------------
 - User selects a folder (vault root)
 - Recursively reads all .md files
 - Builds a knowledge graph:
     Node  = Markdown note
     Edge  = [[wikilink]]
 - Extracts:
     - Wiki links
     - #tags
     - YAML frontmatter aliases
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

        // [[Wiki Links]]
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

        // YAML frontmatter (very lightweight)
        if (text.startsWith("---")) {
            const fm = text.split("---")[1] ?? "";
            const aliasLine = fm.match(/aliases:\s*(.+)/i);
            if (aliasLine) {
                aliasLine[1]
                    .split(",")
                    .map(a => a.trim())
                    .filter(Boolean)
                    .forEach(a => aliases.push(a));
            }
        }

        return {
            links,
            tags: Array.from(tags),
            aliases
        };
    }

    /* -----------------------------------------
     Graph Builder
    ----------------------------------------- */

    async function buildGraphFromVault(vaultName, mdFiles) {
        const nodes = [];
        const edges = [];
        const noteIdByName = new Map();

        // 1. Create nodes
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
                    obsidian: {
                        vault: vaultName,
                        path
                    }
                }
            });
        }

        // Build lookup map for O(1) node access
        const nodeById = new Map(nodes.map(n => [n.data.id, n]));

        // 2. Parse content and create edges
        for (const { file, path } of mdFiles) {
            const text = await file.text();
            const srcId = idSafe(path.replace(/\.md$/i, ""));
            const parsed = parseMarkdown(text);

            const node = nodeById.get(srcId);
            if (node) {
                node.data.obsidian.tags = parsed.tags;
                node.data.obsidian.aliases = parsed.aliases;
            }

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

        const original = window.updateDetailsForNode;
        window.updateDetailsForNode = function (node) {
            original(node);

            const d = node?.data?.();
            if (!d || !d.obsidian) return;

            const container = document.getElementById("onxFloatDetails");
            if (!container) return;

            const vault = d.obsidian.vault;
            const path = d.obsidian.path;

            const uri =
                "obsidian://open?vault=" +
                encodeURIComponent(vault) +
                "&file=" +
                encodeURIComponent(path);

            const block = document.createElement("div");
            block.style.marginTop = "8px";
            const link = document.createElement("a");
            link.href = uri;
            link.style.cssText = "font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "🔗 Open in Obsidian";
            block.appendChild(link);

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