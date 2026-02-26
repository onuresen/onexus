/* =========================================================
 ONEXUS – Persistence (Storage Backend: plain files)
 - Saves full ONEXUS graph + node positions (layout) to backend
 - Restores saved positions after load
 - Optional Auto-Save on node drag (debounced)
 Depends on: window.cy, window.onexusLoadGraph, window.applyLayoutPositions (optional)
 ========================================================= */
(function () {
    const API_BASE = String(window.ONEXUS_PERSIST_BASE || "http://localhost:8787").replace(/\/+$/, "");

    const LS_LAST_ID = "onexus.persist.lastId";
    const LS_LAST_NAME = "onexus.persist.lastName";
    const LS_AUTOSAVE = "onexus.persist.autoSave"; // "1" | "0"

    function nowIso() { return new Date().toISOString(); }

    function getLastId() { try { return localStorage.getItem(LS_LAST_ID); } catch { return null; } }
    function setLastId(id) { try { localStorage.setItem(LS_LAST_ID, String(id)); } catch { } }

    function getLastName() { try { return localStorage.getItem(LS_LAST_NAME) || "Untitled"; } catch { return "Untitled"; } }
    function setLastName(name) { try { localStorage.setItem(LS_LAST_NAME, String(name)); } catch { } }

    function getAutoSaveEnabled() { try { return localStorage.getItem(LS_AUTOSAVE) !== "0"; } catch { return true; } }
    function setAutoSaveEnabled(on) { try { localStorage.setItem(LS_AUTOSAVE, on ? "1" : "0"); } catch { } }

    function buildPositions() {
        const cy = window.cy;
        return cy.nodes().map(n => ({ id: n.id(), position: n.position() }));
    }

    function buildGraphPayload({ includePositions = true } = {}) {
        const cy = window.cy;
        if (!cy) throw new Error("cy not ready");

        const nodes = cy.nodes().map(n => ({ data: n.data() }));
        const edges = cy.edges().map(e => ({ data: e.data() }));

        const meta = {
            exportedAt: nowIso(),
            theme: window.getCurrentThemeKey?.() ?? window.currentTheme ?? "light",
            scale: window.getCurrentScale?.() ?? 1,
            ...(window.__onexus_meta ?? window.___onexus_meta ?? {})
        };

        if (includePositions) {
            meta.layout = meta.layout || {};
            meta.layout.positions = buildPositions();
        }

        return { meta, elements: { nodes, edges } };
    }

    async function listGraphs() {
        const res = await fetch(`${API_BASE}/graphs`, { cache: "no-store" });
        if (!res.ok) throw new Error(`List failed: HTTP ${res.status}`);
        return await res.json();
    }

    async function saveGraph({ id = null, name = "Untitled", includePositions = true } = {}) {
        const graph = buildGraphPayload({ includePositions });
        setLastName(name);

        if (!id) {
            const res = await fetch(`${API_BASE}/graphs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, graph })
            });
            const j = await res.json();
            if (!res.ok || !j.ok) throw new Error(j.error || `Save failed: HTTP ${res.status}`);
            setLastId(j.id);
            window.showTransientMessage?.(`Saved: ${name} (${j.id})`, 1800);
            return j.id;
        } else {
            const res = await fetch(`${API_BASE}/graphs/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, graph })
            });
            const j = await res.json();
            if (!res.ok || !j.ok) throw new Error(j.error || `Update failed: HTTP ${res.status}`);
            setLastId(id);
            window.showTransientMessage?.(`Updated: ${name} (${id})`, 1400);
            return id;
        }
    }

    async function loadGraph(id) {
        const res = await fetch(`${API_BASE}/graphs/${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || `Load failed: HTTP ${res.status}`);
        if (!j.graph) throw new Error("No graph in response");

        // Load graph (core pipeline)
        window.onexusLoadGraph?.(j.graph);

        // Restore saved positions if present
        const positions = j?.graph?.meta?.layout?.positions;
        if (Array.isArray(positions) && positions.length && typeof window.applyLayoutPositions === "function") {
            // Delay slightly so cy has elements
            setTimeout(() => {
                try { window.applyLayoutPositions(positions); } catch { }
            }, 30);
        }

        setLastId(id);
        setLastName(j.name ?? id);
        window.showTransientMessage?.(`Loaded: ${j.name ?? id}`, 1600);
        return j.graph;
    }

    async function deleteGraph(id) {
        const res = await fetch(`${API_BASE}/graphs/${encodeURIComponent(id)}`, { method: "DELETE" });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || `Delete failed: HTTP ${res.status}`);
        window.showTransientMessage?.(`Deleted: ${id}`, 1400);
        const last = getLastId();
        if (last === id) setLastId("");
        return true;
    }

    // ---------------------------------------------------------
    // Auto-save on drag (simple + safe)
    // - Only runs when we have a "last saved id"
    // - Debounced to avoid spamming backend
    // ---------------------------------------------------------
    function debounce(fn, ms = 900) {
        let t = 0;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    const autoSaveNow = debounce(async () => {
        if (!getAutoSaveEnabled()) return;

        const id = getLastId();
        if (!id) return; // must have a saved graph first

        const name = getLastName();
        try {
            // includePositions true = store current node positions
            await saveGraph({ id, name, includePositions: true });
            // (saveGraph already toasts "Updated")
        } catch (e) {
            console.warn("[ONEXUS autosave] failed:", e);
            window.showTransientMessage?.("Auto-save failed (see console)", 1800);
        }
    }, 900);

    function hookAutoSave() {
        const cy = window.cy;
        if (!cy || cy.__onxAutoSaveHooked) return;
        cy.__onxAutoSaveHooked = true;

        // When user finishes dragging a node
        cy.on("dragfree", "node", () => autoSaveNow());

        // Also capture programmatic position changes (optional)
        // cy.on("position", "node", () => autoSaveNow());
    }

    function boot() {
        hookAutoSave();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        setTimeout(boot, 0);
    }

    // Expose
    window.ONEXUS_PERSIST = {
        listGraphs,
        saveGraph,
        loadGraph,
        deleteGraph,
        getAutoSaveEnabled,
        setAutoSaveEnabled,
        getLastId,
        getLastName
    };
})();