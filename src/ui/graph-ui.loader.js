// ===============================
// ONEXUS – Unified Loader (PLUGIN-AWARE + Import-as chooser)
// Exposes: window.handleUnifiedLoad(event)
//
// PATCH (Core improvement):
// - Multi-JSON merge is now deterministic and order-independent.
// - Nodes merge by id with "prefer non-empty / richer" policy (safe).
// - Edges merge by signature (type,dimension,source,target,directional) with stable IDs.
// - Only affects legacy fallback for 2+ JSON files (no plugin candidates).
// ===============================
(function () {
  const U = window.ONEXUS?.util ?? {};
  const escapeHtml = U.escapeHtml ?? ((s) => String(s ?? ""));

  // ---------- Utils ----------
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const normStr = (v) => String(v ?? "").trim();
  const isEmptyStr = (v) => normStr(v) === "";
  const isMeaningful = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return normStr(v) !== "";
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.length > 0;
    if (isObj(v)) return Object.keys(v).length > 0;
    return true;
  };

  // Treat these as "empty-ish" categories (so a real category overwrites them)
  const isTrivialCategory = (v) => {
    const s = normStr(v);
    return !s || s.toLowerCase() === "uncategorized";
  };

  function stableHash36(str) {
    // FNV-1a 32-bit -> base36
    let h = 2166136261;
    const s = String(str ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function uniqArray(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr ?? []) {
      const k = typeof x === "string" ? x : JSON.stringify(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  function mergeArrays(a, b) {
    return uniqArray([...(a ?? []), ...(b ?? [])]);
  }

  function chooseBetterString(a, b) {
    const sa = normStr(a);
    const sb = normStr(b);
    if (!sa && sb) return sb;
    if (sa && !sb) return sa;
    if (!sa && !sb) return "";
    // both exist: choose longer; if tie choose stable lexicographic
    if (sb.length > sa.length) return sb;
    if (sa.length > sb.length) return sa;
    return (sb < sa) ? sb : sa;
  }

  function mergeValuePreferNonEmpty(base, incoming) {
    if (!isMeaningful(base) && isMeaningful(incoming)) return incoming;
    if (isMeaningful(base) && !isMeaningful(incoming)) return base;

    // arrays: union
    if (Array.isArray(base) && Array.isArray(incoming)) return mergeArrays(base, incoming);

    // objects: shallow recursive merge
    if (isObj(base) && isObj(incoming)) {
      const out = { ...base };
      for (const k of Object.keys(incoming)) {
        out[k] = mergeValuePreferNonEmpty(out[k], incoming[k]);
      }
      return out;
    }

    // primitives: pick "better"
    if (typeof base === "string" || typeof incoming === "string") {
      return chooseBetterString(base, incoming);
    }

    // default: keep base (stable, non-destructive)
    return base;
  }

  function normalizeLabel(label, fallback) {
    // Allow string or object; return {en,jp}
    if (isObj(label)) {
      const en = normStr(label.en) || normStr(fallback);
      const jp = normStr(label.jp) || en;
      return { en, jp };
    }
    const en = normStr(label) || normStr(fallback);
    return { en, jp: en };
  }

  function normalizeNodeData(d) {
    const id = normStr(d?.id);
    if (!id) return null;

    const nodeType = normStr(d.nodeType) || "Component";
    const category =
      !isTrivialCategory(d.category) ? normStr(d.category) :
        (normStr(d.revitCategory) || "Uncategorized");

    const label = normalizeLabel(d.label, d.displayLabel ?? id);
    const displayLabel = normStr(d.displayLabel) || label.en || id;

    return {
      ...d,
      id,
      nodeType,
      category,
      label,
      displayLabel,
    };
  }

  function nodeRichnessScore(d) {
    // Used only for tie-breaking: more fields/non-empty means "richer"
    if (!d) return 0;
    let score = 0;

    // strong signals
    if (!isTrivialCategory(d.category)) score += 5;
    if (normStr(d.nodeType)) score += 2;
    if (isObj(d.label) && (normStr(d.label.en) || normStr(d.label.jp))) score += 4;

    // extra fields
    for (const [k, v] of Object.entries(d)) {
      if (k === "id" || k === "displayLabel") continue;
      if (isMeaningful(v)) score += 1;
    }
    return score;
  }

  function mergeNodeData(a, b) {
    // Order-independent merge: choose richer as base, then fill gaps from the other.
    const da = normalizeNodeData(a);
    const db = normalizeNodeData(b);
    if (!da) return db;
    if (!db) return da;

    const sa = nodeRichnessScore(da);
    const sb = nodeRichnessScore(db);

    const base = (sb > sa) ? db : da;
    const other = (base === da) ? db : da;

    const out = { ...base };

    // Prefer real category over Uncategorized
    if (isTrivialCategory(out.category) && !isTrivialCategory(other.category)) out.category = other.category;

    // Merge label per-lang
    out.label = {
      en: chooseBetterString(out.label?.en, other.label?.en) || out.id,
      jp: chooseBetterString(out.label?.jp, other.label?.jp) || (chooseBetterString(out.label?.en, other.label?.en) || out.id),
    };

    // Fill other fields with prefer-non-empty semantics
    for (const k of Object.keys(other)) {
      if (k === "id") continue;
      if (k === "category") continue; // handled above
      if (k === "label") continue;    // handled above
      if (k === "displayLabel") continue; // recompute after merge
      out[k] = mergeValuePreferNonEmpty(out[k], other[k]);
    }

    // Recompute displayLabel (prefer current out.displayLabel but ensure not empty)
    const dl = chooseBetterString(base.displayLabel, other.displayLabel);
    out.displayLabel = dl || out.label.en || out.id;

    // Ensure required fields
    out.nodeType = normStr(out.nodeType) || "Component";
    out.category = normStr(out.category) || "Uncategorized";
    out.label = normalizeLabel(out.label, out.displayLabel ?? out.id);

    return out;
  }

  function edgeSignature(d) {
    const type = normStr(d.type) || "RelatedTo";
    const dimension = normStr(d.dimension) || "System";
    const source = normStr(d.source);
    const target = normStr(d.target);
    const directional = (typeof d.directional === "boolean") ? d.directional : !!d.directional;
    return `${type}\n${dimension}\n${source}\n${target}\n${directional ? 1 : 0}`;
  }

  function normalizeEdgeData(d) {
    const source = normStr(d?.source);
    const target = normStr(d?.target);
    if (!source || !target) return null;

    const type = normStr(d.type) || "RelatedTo";
    const dimension = normStr(d.dimension) || "System";
    const directional = (typeof d.directional === "boolean") ? d.directional : !!d.directional;

    // normalize phase as array
    let phase = d.phase ?? [];
    if (typeof phase === "string") phase = phase.split(/\n/).map(normStr).filter(Boolean);
    if (!Array.isArray(phase)) phase = [];

    return {
      ...d,
      id: normStr(d.id) || "",
      type,
      dimension,
      source,
      target,
      directional,
      phase,
    };
  }

  function mergeEdgeData(a, b) {
    const ea = normalizeEdgeData(a);
    const eb = normalizeEdgeData(b);
    if (!ea) return eb;
    if (!eb) return ea;

    const out = { ...ea };

    // stable merge: union phase
    out.phase = mergeArrays(ea.phase ?? [], eb.phase ?? []);

    // prefer non-empty strings / richer notes
    out.owner = chooseBetterString(ea.owner, eb.owner);
    out.risk = chooseBetterString(ea.risk, eb.risk);
    out.confidence = chooseBetterString(ea.confidence, eb.confidence);
    out.notes = chooseBetterString(ea.notes, eb.notes);

    // merge any other fields, prefer non-empty
    for (const k of Object.keys(eb)) {
      if (k === "id" || k === "phase" || k === "owner" || k === "risk" || k === "confidence" || k === "notes") continue;
      out[k] = mergeValuePreferNonEmpty(out[k], eb[k]);
    }

    // keep a real id if either has it (stable)
    out.id = chooseBetterString(ea.id, eb.id);

    return out;
  }

  function ensureUniqueEdgeIds(edges) {
    const used = new Set();
    for (const e of edges) {
      let id = normStr(e.id);
      if (!id) {
        const sig = edgeSignature(e);
        id = `E_${stableHash36(sig)}`;
      }
      let finalId = id;
      let k = 2;
      while (used.has(finalId)) finalId = `${id}-${k++}`;
      used.add(finalId);
      e.id = finalId;
    }
  }

  // ---------- Merge ONEXUS JSON graphs (legacy fallback only) ----------
  async function mergeJsonFiles(jsonFiles) {
    // 0) stable file ordering to reduce nondeterminism (but merge is order-independent anyway)
    const files = [...jsonFiles].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // 1) parse all
    const texts = await Promise.all(files.map((f) => f.text()));
    const parsed = texts.map((t) => JSON.parse(t));

    // 2) normalize each graph if normalizer exists (safe canonicalization)
    const normFn = window.ONEXUS?.import?.normalizeGraph;
    const graphs = parsed.map((g, i) => {
      try {
        if (typeof normFn === "function") {
          return normFn(g, {
            importer: "json-merge",
            sourceFiles: files.map((f) => f.name),
            sourceKind: "import",
          });
        }
      } catch { /* fall through */ }
      return g;
    });

    // 3) merge nodes by id (order-independent)
    const nodeMap = new Map(); // id -> nodeWrap
    for (const g of graphs) {
      for (const n of (g?.elements?.nodes ?? [])) {
        const d0 = n?.data ?? {};
        const id = normStr(d0.id);
        if (!id) continue;

        const prev = nodeMap.get(id);
        const mergedData = mergeNodeData(prev?.data, d0);
        nodeMap.set(id, { data: mergedData });
      }
    }

    // 4) merge edges by signature (order-independent)
    const edgeMap = new Map(); // signature -> edgeData
    for (const g of graphs) {
      for (const e of (g?.elements?.edges ?? [])) {
        const d0 = normalizeEdgeData(e?.data ?? {});
        if (!d0) continue;
        const sig = edgeSignature(d0);

        const prev = edgeMap.get(sig);
        const merged = prev ? mergeEdgeData(prev, d0) : d0;
        edgeMap.set(sig, merged);

        // ensure endpoints exist in nodeMap (schema-friendly)
        if (!nodeMap.has(d0.source)) {
          nodeMap.set(d0.source, { data: normalizeNodeData({ id: d0.source, nodeType: "Component", category: "Uncategorized", label: { en: d0.source, jp: d0.source }, displayLabel: d0.source }) });
        }
        if (!nodeMap.has(d0.target)) {
          nodeMap.set(d0.target, { data: normalizeNodeData({ id: d0.target, nodeType: "Component", category: "Uncategorized", label: { en: d0.target, jp: d0.target }, displayLabel: d0.target }) });
        }
      }
    }

    const edges = Array.from(edgeMap.values());
    ensureUniqueEdgeIds(edges);

    // 5) build merged graph + meta (safe; core loader will re-normalize if present)
    const merged = {
      meta: {
        schema: "onexus",
        importer: "json-merge",
        importedAt: new Date().toISOString(),
        sourceFiles: files.map((f) => f.name),
        sourceKind: "import",
        mergePolicy: "nodeId:preferNonEmpty+richer; edgeSig:union+preferNonEmpty",
      },
      elements: {
        nodes: Array.from(nodeMap.values()),
        edges: edges.map((d) => ({ data: d })),
      },
    };

    return merged;
  }

  // ---------- Import-as chooser ----------
  function openImporterChoiceDialog(candidates, files) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10070,
      });
      const panel = document.createElement("div");
      Object.assign(panel.style, {
        background: "#fff",
        minWidth: "520px",
        maxWidth: "720px",
        borderRadius: "12px",
        padding: "14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        fontSize: "13px",
        color: "#111",
      });
      const fileList = (files ?? []).map((f) => f?.name).filter(Boolean).join(", ");
      const rows = candidates
        .map((c) => {
          const label = typeof c.label === "string" ? c.label : (c.id ?? "Importer");
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
        })
        .join("");

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

      panel.querySelectorAll(".onx-imp-row").forEach((el) => {
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

    // 1) Plugin import (SINGLE SOURCE OF TRUTH if any candidate exists)
    const candidatesFn = window.ONEXUS?.plugins?.getImporterCandidates;
    const importAsFn = window.ONEXUS?.plugins?.importFilesAs;

    if (typeof candidatesFn === "function" && typeof importAsFn === "function") {
      let candidates = [];
      try {
        candidates = await candidatesFn(files);
      } catch (e) {
        console.warn("[ONEXUS] getImporterCandidates failed:", e);
        candidates = [];
      }

      if (candidates.length > 0) {
        // IMPORTANT: if we have candidates, we do NOT fall back to legacy.
        try {
          if (candidates.length === 1) {
            const chosen = candidates[0];
            const res = await importAsFn(chosen.id, files, { source: "unified-loader" });
            if (!res?.ok) {
              const msg = res?.error?.message ?? res?.error ?? "Importer failed.";
              alert(`Import failed (${chosen.id}): ${msg}`);
              return;
            }
            window.showTransientMessage?.(`Imported: ${chosen.label ?? chosen.id}`);
            return;
          }

          // candidates.length > 1
          const chosenId = await openImporterChoiceDialog(candidates, files);
          const chosen = candidates.find((c) => c.id === chosenId);
          const res = await importAsFn(chosenId, files, {
            source: "unified-loader",
            chosenImporter: chosenId,
          });

          if (!res?.ok) {
            const msg = res?.error?.message ?? res?.error ?? "Importer failed.";
            alert(`Import failed (${chosenId}): ${msg}`);
            return;
          }
          window.showTransientMessage?.(`Imported: ${chosen?.label ?? chosenId}`);
          return;
        } catch (e) {
          // user cancelled chooser OR unexpected error
          const msg = String(e?.message ?? e).toLowerCase();
          if (msg.includes("cancel")) {
            window.showTransientMessage?.("Import cancelled", 1400);
            return; // no legacy fallback
          }
          console.error("[ONEXUS] Import flow error:", e);
          alert("Import failed: " + (e?.message ?? e));
          return; // no legacy fallback
        }
      }
      // candidates.length === 0 -> proceed to legacy fallback below
    }

    // 2) Legacy fallback: JSON / IFC / CSV (only if no plugin candidate exists)
    const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
    const csvFiles = files.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    const ifcFiles = files.filter((f) => {
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

    if (!csvFiles.length) return;

    // Prefer plugin legacy helpers if present
    if (window.ONEXUS_EDGESCSV?.importFiles) {
      try { await window.ONEXUS_EDGESCSV.importFiles(csvFiles); return; }
      catch { /* continue */ }
    }

    if (window.loadCOBieCSVs) {
      window.loadCOBieCSVs?.({ target: { files: csvFiles } });
      return;
    }

    alert("No CSV importer available. Ensure plugins loaded via manifest.json.");
  }

  window.handleUnifiedLoad = handleUnifiedLoad;
})();