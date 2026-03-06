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
const STORAGE_DIR = process.env.ONEXUS_STORAGE_DIR
    ? path.resolve(process.env.ONEXUS_STORAGE_DIR)
    : path.join(__dirname, "storage");

// Ensure storage folder exists
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const app = express();
app.use(cors());
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

function readJson(filePath) {
    const txt = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(txt);
}

function writeJsonAtomic(filePath, obj) {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
}

function validateGraphShape(graph) {
    // Minimal shape validation (backend stays dumb)
    // ONEXUS already validates in frontend (validateOnexusJson) but we do a tiny check here.
    if (!graph || typeof graph !== "object") return "graph must be an object";
    if (!graph.elements || typeof graph.elements !== "object") return "graph.elements missing";
    if (!Array.isArray(graph.elements.nodes)) return "graph.elements.nodes must be array";
    if (!Array.isArray(graph.elements.edges)) return "graph.elements.edges must be array";
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
        } catch {
            // ignore broken files
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

    const p = filePathFor(id);
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "not found" });

    const record = readJson(p);
    res.json({ ok: true, ...record });
});

// Update graph (overwrite)
app.put("/graphs/:id", (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!isValidId(id)) return res.status(400).json({ ok: false, error: "invalid id" });

    const p = filePathFor(id);
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "not found" });

    const existing = readJson(p);

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

    const p = filePathFor(id);
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "not found" });

    fs.unlinkSync(p);
    res.json({ ok: true, id });
});

// ===============================
// Start
// ===============================
app.listen(PORT, () => {
    console.log(`[ONEXUS storage] listening on http://localhost:${PORT}`);
    console.log(`[ONEXUS storage] storage dir: ${STORAGE_DIR}`);
});