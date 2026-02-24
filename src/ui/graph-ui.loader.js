// ===============================
// ONEXUS – Unified Loader (PLUGIN-AWARE + "Import as..." chooser)
// Exposes:
//   window.handleUnifiedLoad(event)
//   window.injectOnexusEdgesCsv(csvText)  // delegates if plugin exists
// ===============================
(function () {

  // ---------- Merge ONEXUS JSON graphs (nodes by id; edges by tuple) ----------
  async function mergeJsonFiles(jsonFiles) {
    const texts = await Promise.all(jsonFiles.map(f => f.text()));
    const graphs = texts.map(t => JSON.parse(t));

    const normNode = (d) => {
      const out = { ...d };
      out.id = out.id ?? `N_${Math.random().toString(36).slice(2)}`;
      out.nodeType = out.nodeType ?? "Component";
      out.category = out.category ?? out.revitCategory ?? "Uncategorized";
      if (typeof out.label !== "object" || out.label === null) {
        const base = out.displayLabel ?? out.id;
        out.label = { en: String(base), jp: String(base) };
      }
      return out;
    };

    const edgeKey = (d) =>
      `${d.type}\n${d.dimension}\n${d.source}\n${d.target}\n${d.directional ? 1 : 0}`;

    const nodeMap = new Map();
    for (const g of graphs) {
      for (const n of (g?.elements?.nodes ?? [])) {
        const d = normNode(n?.data ?? {});
        const prev = nodeMap.get(d.id);
        nodeMap.set(d.id, { data: prev ? { ...prev.data, ...d } : { ...d } });
      }
    }

    const edgeMap = new Map();
    for (const g of graphs) {
      for (const e of (g?.elements?.edges ?? [])) {
        const raw = e?.data ?? {};
        if (!raw.type || !raw.dimension || !raw.source || !raw.target || typeof raw.directional !== "boolean") continue;
        const k = edgeKey(raw);
        const prev = edgeMap.get(k);
        edgeMap.set(k, { data: prev ? { ...prev.data, ...raw } : { ...raw } });
      }
    }

    const usedIds = new Set();
    const edges = [];
    let seq = 0;
    edgeMap.forEach((wrap) => {
      const d = wrap.data;
      let id = (d.id && !usedIds.has(d.id)) ? d.id : null;
      if (!id) id = `E_${++seq}`;
      usedIds.add(id);
      edges.push({ data: { ...d, id } });
    });

    const nodes = Array.from(nodeMap.values());
    return { elements: { nodes, edges } };
  }

  // ---------- CSV Choice dialog (legacy ambiguous CSV) ----------
  function openCsvChoiceDialog() {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10060
      });

      const panel = document.createElement("div");
      Object.assign(panel.style, {
        background: "#fff", minWidth: "380px", borderRadius: "10px", padding: "14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", fontSize: "13px", color: "#111"
      });

      panel.innerHTML = `
        <div style="font-weight:700;margin-bottom:8px;">Choose CSV Type</div>
        <div style="color:#374151;line-height:1.45;margin-bottom:12px;">
          We detected CSV input. Select how to import:
        </div>
        <div style="display:grid;gap:10px;">
          <button id="csv-cobie"
            style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;text-align:left;">
            <div style="font-weight:700;">COBie CSV</div>
            <div style="font-size:12px;color:#6b7280;">Component / Type / System / Assembly / Space</div>
          </button>
          <button id="csv-onexus"
            style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;text-align:left;">
            <div style="font-weight:700;">ONEXUS Edges CSV</div>
            <div style="font-size:12px;color:#6b7280;">From “Export CSV” (id,type,dimension,directional,source,target,...)</div>
          </button>
          <button id="csv-cancel"
            style="padding:8px;border:0;border-radius:10px;background:#111827;color:#fff;cursor:pointer;">
            Cancel
          </button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      const cleanup = () => { try { overlay.remove(); } catch { } };
      panel.querySelector("#csv-cancel").addEventListener("click", () => { cleanup(); reject(new Error("cancel")); });
      panel.querySelector("#csv-cobie").addEventListener("click", () => { cleanup(); resolve("cobie"); });
      panel.querySelector("#csv-onexus").addEventListener("click", () => { cleanup(); resolve("onexus-edges"); });
    });
  }

  // ---------- Import-as chooser for plugin importers ----------
  function openImporterChoiceDialog(candidates, files) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10070
      });

      const panel = document.createElement("div");
      Object.assign(panel.style, {
        background: "#fff", minWidth: "520px", maxWidth: "720px",
        borderRadius: "12px", padding: "14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", fontSize: "13px", color: "#111"
      });

      const fileList = (files || []).map(f => f?.name).filter(Boolean).join(", ");
      const rows = candidates.map(c => {
        const label = typeof c.label === "string" ? c.label : (c.id || "Importer");
        const help = c.help ? String(c.help) : "";
        const score = (c.__score != null) ? `score:${c.__score}` : "";
        return `
          <div class="onx-imp-row" data-id="${c.id}"
               style="padding:10px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;cursor:pointer;">
            <div style="display:flex;align-items:baseline;gap:10px;">
              <div style="font-weight:800;">${escapeHtml(label)}</div>
              <div style="font-size:12px;color:#6b7280;">${escapeHtml(c.id)} ${score ? `· ${escapeHtml(score)}` : ""}</div>
            </div>
            ${help ? `<div style="margin-top:4px;font-size:12px;color:#374151;line-height:1.35;">${escapeHtml(help)}</div>` : ""}
          </div>
        `;
      }).join("");

      panel.innerHTML = `
        <div style="font-weight:900;margin-bottom:6px;">Import as…</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:10px;line-height:1.35;">
          Multiple importers can handle: <b>${escapeHtml(fileList)}</b><br/>
          Choose which importer to use:
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;max-height:56vh;overflow:auto;">
          ${rows}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
          <button id="imp-cancel"
                  style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;">
            Cancel
          </button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      const cleanup = () => { try { overlay.remove(); } catch { } };
      panel.querySelector("#imp-cancel").addEventListener("click", () => { cleanup(); reject(new Error("cancel")); });

      panel.querySelectorAll(".onx-imp-row").forEach(el => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          cleanup();
          resolve(id);
        });
      });

      const onEsc = (e) => {
        if (e.key === "Escape") {
          cleanup();
          document.removeEventListener("keydown", onEsc);
          reject(new Error("cancel"));
        }
      };
      document.addEventListener("keydown", onEsc);
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  // ---------- plugin candidate scoring (local; avoids needing plugin-core changes) ----------
  async function readFileHeadText(file, maxBytes = 8192) {
    const slice = file.slice(0, Math.min(maxBytes, file.size));
    const buf = await slice.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: false }).decode(buf); } catch { return ""; }
  }
  function fileExt(name) {
    const s = String(name || "").toLowerCase();
    const i = s.lastIndexOf(".");
    return i >= 0 ? s.slice(i + 1) : "";
  }

  async function getPluginImporterCandidates(files) {
    const listFn = window.ONEXUS?.plugins?.listImporters;
    const list = (typeof listFn === "function") ? listFn() : (window.ONEXUS?.plugins?.importers || []);
    if (!Array.isArray(list) || !list.length) return [];

    const exts = new Set(files.map(f => fileExt(f.name)));
    const head = files[0] ? await readFileHeadText(files[0]) : "";

    const candidates = [];
    for (const imp of list) {
      try {
        // capability check
        let ok = true;
        if (typeof imp.canHandleFiles === "function") ok = await imp.canHandleFiles(files, { fileExt, readFileHeadText });
        else if (typeof imp.canHandleText === "function") ok = await imp.canHandleText(head, files[0], { fileExt });
        if (!ok) continue;

        // score: priority + ext matches + multi compatibility
        let score = Number.isFinite(imp.priority) ? imp.priority : 50;
        if (Array.isArray(imp.extensions)) for (const x of imp.extensions) if (exts.has(String(x).toLowerCase())) score += 25;
        if (files.length > 1 && !imp.acceptMultiple) score -= 20;

        candidates.push({ ...imp, __score: score });
      } catch {
        // ignore importer failures during probing
      }
    }
    candidates.sort((a, b) => (b.__score - a.__score) || String(a.id).localeCompare(String(b.id)));
    return candidates;
  }

  // Force-import with a specific importer (works even if plugin-core lacks importFilesAs)
  async function importViaSpecificImporter(importerId, files, opts = {}) {
    const listFn = window.ONEXUS?.plugins?.listImporters;
    const list = (typeof listFn === "function") ? listFn() : (window.ONEXUS?.plugins?.importers || []);
    const imp = (list || []).find(x => String(x.id) === String(importerId));
    if (!imp) throw new Error("Importer not found: " + importerId);

    const ctx = {
      cy: window.cy,
      state: window.__onexus_state,
      meta: window.__onexus_meta,
      opts,
      util: { readFileHeadText, fileExt }
    };

    if (typeof imp.importFiles === "function") return imp.importFiles(files, ctx);
    if (typeof imp.importText === "function") {
      const text = await files[0].text();
      return imp.importText(text, files[0], ctx);
    }
    throw new Error("Importer has no importFiles/importText: " + importerId);
  }

  // ---------- Legacy delegate kept for compatibility ----------
  function injectOnexusEdgesCsv(csvText) {
    if (window.ONEXUS_EDGESCSV?.importText) return window.ONEXUS_EDGESCSV.importText(csvText);
    alert("ONEXUS Edges CSV plugin is not loaded (ONEXUS_EDGESCSV missing).");
  }

  // ---------- Unified loader ----------
  async function handleUnifiedLoad(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;

    // 1) Plugin import UX
    const pluginImportFn = window.ONEXUS?.plugins?.importFiles;
    if (typeof pluginImportFn === "function") {
      const candidates = await getPluginImporterCandidates(files);

      if (candidates.length === 1) {
        // single match -> import directly
        try {
          await importViaSpecificImporter(candidates[0].id, files, { source: "unified-loader" });
          window.showTransientMessage?.(`Imported: ${candidates[0].label || candidates[0].id}`);
          return;
        } catch (e) {
          console.error("Plugin import failed", e);
        }
      } else if (candidates.length > 1) {
        // multiple matches -> choose
        try {
          const chosenId = await openImporterChoiceDialog(candidates, files);
          await importViaSpecificImporter(chosenId, files, { source: "unified-loader", chosenImporter: chosenId });
          const chosen = candidates.find(c => c.id === chosenId);
          window.showTransientMessage?.(`Imported: ${chosen?.label || chosenId}`);
          return;
        } catch (e) {
          // user cancelled or failed -> fall through to legacy
        }
      }
      // no plugin candidate -> fallthrough to legacy
    }

    // 2) Legacy fallback behavior (preserve your current semantics)
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith(".json"));
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith(".csv"));
    const ifcFiles = files.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith(".ifc") || n.endsWith(".ifczip");
    });

    // JSON: single -> normal, >=2 -> merge then load
    if (jsonFiles.length === 1) {
      const evt = { target: { files: [jsonFiles[0]] } };
      window.loadJSON?.(evt);
    } else if (jsonFiles.length >= 2) {
      try {
        const merged = await mergeJsonFiles(jsonFiles);
        window.onexusLoadGraph?.(merged);
      } catch (err) {
        alert("Failed to merge JSON files: " + (err?.message ?? err));
      }
    }

    // IFC legacy: pass selection to IFC loader if present
    if (ifcFiles.length && window.ONEXUS_IFC?.loadIFC) {
      return window.ONEXUS_IFC.loadIFC({ target: { files: ifcFiles } });
    }

    // CSV legacy: COBie vs ambiguous dialog
    if (!csvFiles.length) return;

    // COBie heuristic by file name
    const cobieFileRe = /(^|[\/._-])(cobie[_-]?)?(component|type|system|assembly|space)\.csv$/i;
    if (csvFiles.some(f => cobieFileRe.test(String(f.name ?? "")))) {
      window.loadCOBieCSVs?.({ target: { files: csvFiles } });
      return;
    }

    // Ambiguous: ask user (legacy)
    const first = csvFiles[0];
    const text = await first.text().catch(() => "");
    openCsvChoiceDialog()
      .then(choice => {
        if (choice === "cobie") window.loadCOBieCSVs?.({ target: { files: csvFiles } });
        else if (choice === "onexus-edges") injectOnexusEdgesCsv(text);
      })
      .catch(() => { /* cancelled */ });
  }

  // Expose
  window.handleUnifiedLoad = handleUnifiedLoad;
  window.injectOnexusEdgesCsv = injectOnexusEdgesCsv;
})();