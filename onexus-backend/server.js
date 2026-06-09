import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// Config
// ===============================
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || process.env.ONEXUS_HOST || "127.0.0.1";
const STORAGE_DIR = process.env.ONEXUS_STORAGE_DIR
    ? path.resolve(process.env.ONEXUS_STORAGE_DIR)
    : path.join(__dirname, "storage");
// ONEXUS_ALLOWED_ORIGIN: set to your frontend URL in non-local deployments.
// Defaults to localhost:4173 (the dev server). Use "*" to allow any origin (not recommended).
const ALLOWED_ORIGIN = process.env.ONEXUS_ALLOWED_ORIGIN || "http://localhost:4173";

// Ensure storage folder exists
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "25mb" })); // graphs can be big; adjust as needed

// ===============================
// Helpers
// ===============================
function nowIso() {
    return new Date().toISOString();
}

function safeName(name) {
    return String(name ?? "").trim().slice(0, 200) || "Untitled";
}

function newId() {
    // short, readable id
    const t = Date.now().toString(36);
    const r = crypto.randomBytes(4).toString("hex");
    return `g_${t}_${r}`;
}

// Only allow safe graph IDs: alphanumeric, hyphens, underscores, max 128 chars
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidId(id) {
    return typeof id === "string" && SAFE_ID_RE.test(id);
}

function filePathFor(id) {
    return path.join(STORAGE_DIR, `${id}.json`);
}

// Reads + parses a JSON file. Throws a tagged error so callers can map it to
// the right HTTP status (ENOENT -> 404, parse failure -> 500 "corrupted").
function readJson(filePath) {
    let txt;
    try {
        txt = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
        if (e && e.code === "ENOENT") { e.onexus = "missing"; }
        throw e;
    }
    try {
        return JSON.parse(txt);
    } catch (e) {
        e.onexus = "corrupted";
        throw e;
    }
}

// Maps a readJson() error to an Express response. Returns true if handled.
function handleReadError(e, res) {
    if (e && (e.onexus === "missing" || e.code === "ENOENT")) {
        res.status(404).json({ ok: false, error: "not found" });
        return true;
    }
    if (e && e.onexus === "corrupted") {
        console.error(`[ONEXUS storage] corrupted graph file:`, e.message);
        res.status(500).json({ ok: false, error: "stored graph is corrupted and could not be read" });
        return true;
    }
    return false;
}

function writeJsonAtomic(filePath, obj) {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
}

// Upper bound on element count — guards against accidental/malicious huge payloads
// even within the 25mb body limit. Override with ONEXUS_MAX_ELEMENTS.
const MAX_ELEMENTS = Number(process.env.ONEXUS_MAX_ELEMENTS) || 200000;

function validateGraphShape(graph) {
    // Minimal shape validation (backend stays dumb)
    // ONEXUS already validates in frontend (validateOnexusJson) but we do a tiny check here.
    if (!graph || typeof graph !== "object") return "graph must be an object";
    if (!graph.elements || typeof graph.elements !== "object") return "graph.elements missing";
    const { nodes, edges } = graph.elements;
    if (!Array.isArray(nodes)) return "graph.elements.nodes must be array";
    if (!Array.isArray(edges)) return "graph.elements.edges must be array";
    if (nodes.length + edges.length > MAX_ELEMENTS) {
        return `graph too large: ${nodes.length + edges.length} elements exceeds limit of ${MAX_ELEMENTS}`;
    }
    // Duplicate node-id detection — silently overlapping ids corrupt the graph downstream.
    const seen = new Set();
    for (const n of nodes) {
        const id = n?.data?.id;
        if (id == null) continue; // frontend normalizer fills ids; don't hard-reject here
        if (seen.has(id)) return `duplicate node id: ${id}`;
        seen.add(id);
    }
    return null;
}

function listAllGraphs() {
    const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith(".json"));
    const items = [];
    for (const f of files) {
        try {
            const p = path.join(STORAGE_DIR, f);
            const data = readJson(p);
            items.push({
                id: data.id,
                name: data.name,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                sizeBytes: fs.statSync(p).size,
                // optional quick counts
                counts: {
                    nodes: data?.graph?.elements?.nodes?.length ?? 0,
                    edges: data?.graph?.elements?.edges?.length ?? 0
                }
            });
        } catch (e) {
            // Skip broken files but surface which one, so corruption isn't invisible.
            console.warn(`[ONEXUS storage] skipping unreadable file ${f}: ${e.message}`);
        }
    }
    items.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
    return items;
}

// ===============================
// Routes
// ===============================

// Health
app.get("/health", (_req, res) => {
    res.json({ ok: true, time: nowIso(), storageDir: STORAGE_DIR });
});

// List graphs
app.get("/graphs", (_req, res) => {
    res.json(listAllGraphs());
});

// Create graph
app.post("/graphs", (req, res) => {
    const name = safeName(req.body?.name);
    const graph = req.body?.graph;

    const err = validateGraphShape(graph);
    if (err) return res.status(400).json({ ok: false, error: err });

    const id = newId();
    const record = {
        id,
        name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        graph
    };

    writeJsonAtomic(filePathFor(id), record);
    res.json({ ok: true, id });
});

// Get graph
app.get("/graphs/:id", (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!isValidId(id)) return res.status(400).json({ ok: false, error: "invalid id" });

    // Read directly and map errors (no existsSync race; handles missing/corrupted).
    let record;
    try {
        record = readJson(filePathFor(id));
    } catch (e) {
        if (handleReadError(e, res)) return;
        throw e;
    }
    res.json({ ok: true, ...record });
});

// Update graph (overwrite)
app.put("/graphs/:id", (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!isValidId(id)) return res.status(400).json({ ok: false, error: "invalid id" });

    const p = filePathFor(id);

    let existing;
    try {
        existing = readJson(p);
    } catch (e) {
        if (handleReadError(e, res)) return;
        throw e;
    }

    const name = safeName(req.body?.name ?? existing.name);
    const graph = req.body?.graph ?? existing.graph;

    const err = validateGraphShape(graph);
    if (err) return res.status(400).json({ ok: false, error: err });

    const updated = {
        ...existing,
        name,
        updatedAt: nowIso(),
        graph
    };

    writeJsonAtomic(p, updated);
    res.json({ ok: true, id });
});

// Delete graph
app.delete("/graphs/:id", (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!isValidId(id)) return res.status(400).json({ ok: false, error: "invalid id" });

    // Unlink directly; map a missing file to 404 (no existsSync race).
    try {
        fs.unlinkSync(filePathFor(id));
    } catch (e) {
        if (e && e.code === "ENOENT") return res.status(404).json({ ok: false, error: "not found" });
        throw e;
    }
    res.json({ ok: true, id });
});

// ===============================
// Error handler (always respond with JSON, never an HTML stack trace)
// ===============================
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    // Body too large (express.json limit) or malformed JSON body.
    if (err?.type === "entity.too.large") {
        return res.status(413).json({ ok: false, error: "payload too large" });
    }
    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({ ok: false, error: "invalid JSON body" });
    }
    console.error("[ONEXUS storage] unhandled error:", err?.message ?? err);
    res.status(500).json({ ok: false, error: "internal error" });
});

// ===============================
// Start
// ===============================
app.listen(PORT, HOST, () => {
    const publicHost = !["127.0.0.1", "localhost", "::1"].includes(String(HOST).toLowerCase());
    console.log(`[ONEXUS storage] listening on http://${HOST}:${PORT}`);
    console.log(`[ONEXUS storage] storage dir: ${STORAGE_DIR}`);
    if (ALLOWED_ORIGIN === "*") {
        console.warn("[ONEXUS storage] WARNING: ONEXUS_ALLOWED_ORIGIN='*' allows any browser origin. Use only on trusted local networks.");
    }
    if (publicHost) {
        console.warn("[ONEXUS storage] WARNING: backend is not bound to localhost. This service has no authentication by design.");
    }
});
