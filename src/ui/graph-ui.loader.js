// ===============================
// ONEXUS – Unified Loader (PLUGIN-AWARE + Import-as chooser)
// Exposes: window.handleUnifiedLoad(event)
// ===============================
(function () {
  const U = window.ONEXUS?.util || {};
  const escapeHtml = U.escapeHtml || ((s) => String(s ?? ""));

  // ---------- Merge ONEXUS JSON graphs (nodes by id; edges by tuple) ----------
  async function mergeJsonFiles(jsonFiles) {
    const texts = await Promise.all(jsonFiles.map((f) => f.text()));
    const graphs = texts.map((t) => JSON.parse(t));

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

    return { elements: { nodes: Array.from(nodeMap.values()), edges } };
  }

  // ---------- Import-as chooser ----------
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
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        fontSize: "13px", color: "#111"
      });

      const fileList = (files ?? []).map(f => f?.name).filter(Boolean).join(", ");
      const rows = candidates.map(c => {
        const label = typeof c.label === "string" ? c.label : (c.id || "Importer");
        const help = c.help ? String(c.help) : "";
        const score = (c.__score != null) ? `score:${c.__score}` : "";
        return `
          <div class="onx-imp-row" data-id="${escapeHtml(c.id)}"
               style="padding:10px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;cursor:pointer;">
            <div style="display:flex;align-items:baseline;gap:10px;">
              <div style="font-weight:800;">${escapeHtml(label)}</div>
              <div style="font-size:12px;color:#6b7280;">${escapeHtml(c.id)}${score ? ` · ${escapeHtml(score)}` : ""}</div>
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

      panel.querySelector("#imp-cancel").addEventListener("click", () => {
        cleanup();
        reject(new Error("cancel"));
      });

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

  // ---------- Unified loader ----------
  async function handleUnifiedLoad(event) {
    const files = Array.from(event?.target?.files ?? []);
    if (!files.length) return;

    // 1) Plugin import (preferred)
    const candidatesFn = window.ONEXUS?.plugins?.getImporterCandidates;
    const importAsFn = window.ONEXUS?.plugins?.importFilesAs;
    if (typeof candidatesFn === "function" && typeof importAsFn === "function") {
      const candidates = await candidatesFn(files);

      if (candidates.length === 1) {
        const res = await importAsFn(candidates[0].id, files, { source: "unified-loader" });
        if (res?.ok) window.showTransientMessage?.(`Imported: ${candidates[0].label ?? candidates[0].id}`);
        return;
      }

      if (candidates.length > 1) {
        try {
          const chosenId = await openImporterChoiceDialog(candidates, files);
          const res = await importAsFn(chosenId, files, { source: "unified-loader", chosenImporter: chosenId });
          if (res?.ok) {
            const chosen = candidates.find(c => c.id === chosenId);
            window.showTransientMessage?.(`Imported: ${chosen?.label ?? chosenId}`);
          }
          return;
        } catch {
          // user cancelled -> continue to legacy fallback
        }
      }
      // zero candidates -> legacy fallback
    }

    // 2) Legacy fallback: JSON / IFC / CSV
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith(".json"));
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith(".csv"));
    const ifcFiles = files.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith(".ifc") || n.endsWith(".ifczip");
    });

    if (jsonFiles.length === 1) {
      window.loadJSON?.({ target: { files: [jsonFiles[0]] } });
      return;
    }
    if (jsonFiles.length >= 2) {
      try {
        const merged = await mergeJsonFiles(jsonFiles);
        window.onexusLoadGraph?.(merged);
        return;
      } catch (err) {
        alert("Failed to merge JSON files: " + (err?.message ?? err));
        return;
      }
    }

    if (ifcFiles.length && window.ONEXUS_IFC?.loadIFC) {
      await window.ONEXUS_IFC.loadIFC({ target: { files: ifcFiles } });
      return;
    }

    // If we reach here, it's CSV legacy, but we can only support if COBie/EdgesCSV functions exist.
    if (!csvFiles.length) return;

    // COBie heuristic by file name (fixed, no embedded newlines)
    const cobieSheetRe = /(cobie[_-]?)?(component|type|system|assembly|space)\.csv$/i;
    if (csvFiles.some(f => cobieSheetRe.test(String(f.name ?? "")))) {
      window.loadCOBieCSVs?.({ target: { files: csvFiles } });
      return;
    }

    // If edges CSV plugin exists, attempt direct import
    if (window.ONEXUS_EDGESCSV?.importFiles) {
      try {
        await window.ONEXUS_EDGESCSV.importFiles(csvFiles);
        return;
      } catch (e) {
        // continue to COBie fallback
      }
    }

    // Final fallback: treat as COBie if available
    if (window.loadCOBieCSVs) {
      window.loadCOBieCSVs?.({ target: { files: csvFiles } });
      return;
    }

    alert("No CSV importer available. Ensure plugins loaded via manifest.json.");
  }

  window.handleUnifiedLoad = handleUnifiedLoad;
})();