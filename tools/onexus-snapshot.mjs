#!/usr/bin/env node
/**
 * ONEXUS Snapshot Pack
 * - Creates docs/snapshot/ with:
 *   - manifest.json (tree + sizes + hashes)
 *   - concat.txt (all code text stitched)
 *   - top-imports.txt (script/link tags in index.html*)
 *
 * Usage:
 *   node tools/onexus-snapshot.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "snapshot");
const INCLUDE_EXT = new Set([
    ".js", ".mjs", ".cjs", ".ts",
    ".css", ".html", ".md", ".json",
    ".yml", ".yaml"
]);

const EXCLUDE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", ".next",
    "bin", "obj", ".idea", ".vscode", "coverage",
    "assets/wasm", "samples", "sample", "data" // tweak if needed
]);

function sha256(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function isExcluded(pRel) {
    const parts = pRel.split(path.sep).filter(Boolean);
    if (!parts.length) return false;
    // exclude if any segment matches
    return parts.some(seg => EXCLUDE_DIRS.has(seg) || EXCLUDE_DIRS.has(parts.slice(0, 2).join("/")));
}

function walk(dir, fileList = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        const rel = path.relative(ROOT, abs);

        if (isExcluded(rel)) continue;

        if (ent.isDirectory()) walk(abs, fileList);
        else fileList.push({ abs, rel });
    }
    return fileList;
}

function safeReadText(abs) {
    const buf = fs.readFileSync(abs);
    // heuristic: treat as text if no NUL bytes and decodable
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function extractIndexImports(htmlText) {
    const lines = htmlText.split(/\r?\n/);
    const hits = [];
    for (const L of lines) {
        const s = L.trim();
        if (s.startsWith("<script") || s.startsWith("<link")) hits.push(s);
    }
    return hits.join("\n");
}

ensureDir(OUT_DIR);

const files = walk(ROOT)
    .filter(f => INCLUDE_EXT.has(path.extname(f.rel).toLowerCase()))
    .sort((a, b) => a.rel.localeCompare(b.rel));

const manifest = {
    generatedAt: new Date().toISOString(),
    root: path.basename(ROOT),
    includeExt: Array.from(INCLUDE_EXT),
    excludeDirs: Array.from(EXCLUDE_DIRS),
    files: []
};

let concat = "";
let indexImports = "";

for (const f of files) {
    const stat = fs.statSync(f.abs);
    const buf = fs.readFileSync(f.abs);
    const hash = sha256(buf);

    manifest.files.push({
        path: f.rel.replaceAll("\\", "/"),
        bytes: stat.size,
        sha256: hash
    });

    const text = safeReadText(f.abs);
    if (text != null) {
        concat += `\n\n/* ===== FILE: ${f.rel.replaceAll("\\", "/")} ===== */\n`;
        concat += text;
        concat += "\n";
    }

    // capture index imports for quick boot-order checks
    const base = path.basename(f.rel).toLowerCase();
    if (base === "index.html" || base === "index_leftrail.html") {
        try { indexImports += `\n\n# ${f.rel}\n` + extractIndexImports(text ?? ""); } catch { }
    }
}

fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "concat.txt"), concat, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "top-imports.txt"), indexImports.trim() + "\n", "utf8");

console.log(`Snapshot written to: ${path.relative(ROOT, OUT_DIR)}`);
console.log(`Files indexed: ${manifest.files.length}`);