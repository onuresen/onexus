/* ONEXUS – Context: Manual Relation Editing (Link Wizard API)
   PATCH: drag-to-connect preview (rubber-band) + Alt+Drag start from node
   Keeps existing context menu start/cancel and tap-to-connect behavior.
*/
(function () {
  const cy = window.cy;
  const state = window.__onexus_state;
  const editState = window.__onexus_edit;
  const LABELS = window.__onexus_labels;
  const DIMENSION_DEFAULTS = window.__onexus_dims;

  // --- internal drag-preview state
  const drag = {
    canvas: null,
    ctx: null,
    active: false,
    end: { x: 0, y: 0 },
    raf: 0,
    hoverTarget: null,
    hooked: false,
    dpr: 1,
    // NEW: Alt+Drag state
    altDrag: {
      armed: false,       // Alt pressed on a node (started link)
      sourceId: null,     // id of source node at arming time
    }
  };

  function exists(col) { return !!col && !!col.nonempty && col.nonempty(); }

  // --- UI chip (existing)
  function ensureLinkChip() {
    let chip = document.getElementById("onexus-link-chip");
    if (chip) return chip;

    const toolbar = document.getElementById("toolbar");
    if (!toolbar) return null;

    chip = document.createElement("div");
    chip.id = "onexus-link-chip";
    Object.assign(chip.style, {
      display: "none",
      marginLeft: "8px",
      padding: "4px 8px",
      border: "1px solid var(--stroke)",
      borderRadius: "999px",
      background: "var(--bg-soft)",
      color: "var(--text-main)",
      fontSize: "12px",
      alignItems: "center",
      gap: "8px",
      whiteSpace: "nowrap",
      userSelect: "none",
    });

    const text = document.createElement("span");
    text.id = "onexus-link-chip-text";

    const btn = document.createElement("button");
    btn.textContent = "Cancel";
    Object.assign(btn.style, {
      marginLeft: "8px",
      padding: "2px 8px",
      borderRadius: "10px",
      border: "1px solid var(--stroke)",
      background: "var(--btn-bg)",
      cursor: "pointer",
      fontSize: "12px",
    });
    btn.addEventListener("click", () => cancelManualLink());

    chip.appendChild(text);
    chip.appendChild(btn);
    toolbar.appendChild(chip);
    return chip;
  }

  function updateLinkChip() {
    const chip = ensureLinkChip();
    if (!chip) return;

    const text = document.getElementById("onexus-link-chip-text");
    if (editState?.linkSource) {
      chip.style.display = "flex";
      const lbl = editState.linkSource.data("displayLabel") ?? editState.linkSource.id();
      text.textContent = `Linking from: ${lbl} (drag to a target node)`;
    } else {
      chip.style.display = "none";
    }
  }

  // --- rubber-band canvas overlay
  function ensureLinkCanvas() {
    if (drag.canvas && drag.canvas.isConnected) return drag.canvas;

    const host = cy?.container?.();
    if (!host) return null;

    const c = document.createElement("canvas");
    c.id = "onexus-link-canvas";
    Object.assign(c.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: 6,
    });

    host.style.position = host.style.position || "relative";
    host.appendChild(c);

    drag.canvas = c;
    drag.ctx = c.getContext("2d");
    resizeLinkCanvas();
    return c;
  }

  function resizeLinkCanvas() {
    const c = drag.canvas;
    const host = cy?.container?.();
    if (!c || !host) return;

    const rect = host.getBoundingClientRect();
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    drag.dpr = dpr;

    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";

    const ctx = drag.ctx;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clearLinkCanvas() {
    if (!drag.ctx || !drag.canvas) return;
    const host = cy?.container?.();
    if (!host) return;

    const rect = host.getBoundingClientRect();
    drag.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  function drawFrame() {
    drag.raf = 0;
    if (!drag.active || !editState?.linkSource) return;

    ensureLinkCanvas();
    const ctx = drag.ctx;
    const host = cy?.container?.();
    if (!ctx || !host) return;

    const rect = host.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    const src = editState.linkSource;
    if (!exists(src)) return;

    const p0 = src.renderedPosition();
    const p1 = drag.end;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = "#2563eb";
    ctx.shadowColor = "rgba(37,99,235,0.18)";
    ctx.shadowBlur = 6;

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function requestDraw() {
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(drawFrame);
  }

  function setDragEndFromClientXY(clientX, clientY) {
    const host = cy?.container?.();
    if (!host) return;
    const rect = host.getBoundingClientRect();
    drag.end.x = clientX - rect.left;
    drag.end.y = clientY - rect.top;
    requestDraw();
  }

  function setDragEndFromRenderedPos(pos) {
    drag.end.x = pos.x;
    drag.end.y = pos.y;
    requestDraw();
  }

  function startPreview() {
    drag.active = true;
    ensureLinkCanvas();
    resizeLinkCanvas();
    requestDraw();
  }

  function stopPreview() {
    drag.active = false;
    drag.hoverTarget = null;
    if (drag.raf) cancelAnimationFrame(drag.raf);
    drag.raf = 0;
    clearLinkCanvas();
  }

  function setHoverTarget(nodeOrNull) {
    if (drag.hoverTarget && exists(drag.hoverTarget)) drag.hoverTarget.removeClass("linkTarget");
    drag.hoverTarget = nodeOrNull && exists(nodeOrNull) ? nodeOrNull : null;
    if (drag.hoverTarget) drag.hoverTarget.addClass("linkTarget");
  }

  // --- Hook cytoscape events once
  function ensureDragHooks() {
    if (drag.hooked) return;
    drag.hooked = true;

    // NEW: Alt+Drag start on node
    cy.on("mousedown", "node", (evt) => {
      const oe = evt?.originalEvent;
      if (!oe || !oe.altKey) return;

      // prevent normal node dragging/panning while Alt-dragging link
      try { oe.preventDefault?.(); oe.stopPropagation?.(); } catch { }

      const n = evt.target;
      if (!n || !exists(n)) return;

      beginManualLink(n);               // sets linkSource + chip + highlight
      drag.altDrag.armed = true;
      drag.altDrag.sourceId = n.id();
      startPreview();
      if (evt?.renderedPosition) setDragEndFromRenderedPos(evt.renderedPosition);
    });

    // mouse move
    cy.on("mousemove", (evt) => {
      if (!editState?.linkSource) return;

      // while linking, keep preview updated
      if (evt?.renderedPosition) setDragEndFromRenderedPos(evt.renderedPosition);
      else if (evt?.originalEvent) setDragEndFromClientXY(evt.originalEvent.clientX, evt.originalEvent.clientY);

      startPreview();
    });

    // touch move
    cy.on("touchmove", (evt) => {
      if (!editState?.linkSource) return;
      if (evt?.renderedPosition) setDragEndFromRenderedPos(evt.renderedPosition);
      startPreview();
    });

    // highlight target on hover
    cy.on("mouseover", "node", (evt) => {
      if (!editState?.linkSource) return;
      const n = evt.target;
      if (!n || !exists(n)) return;
      if (editState.linkSource && n.id() !== editState.linkSource.id()) setHoverTarget(n);
    });

    cy.on("mouseout", "node", () => {
      if (!editState?.linkSource) return;
      setHoverTarget(null);
    });

    // drop-to-connect
    cy.on("mouseup", (evt) => {
      if (!editState?.linkSource) return;
      if (!drag.active) return;

      // If mouseup is on a node, connect
      if (evt?.target && evt.target !== cy && evt.target.isNode && evt.target.isNode()) {
        const tgt = evt.target;
        if (exists(tgt) && tgt.id() !== editState.linkSource.id()) {
          drag.altDrag.armed = false;
          drag.altDrag.sourceId = null;
          openEdgeWizard(editState.linkSource, tgt, { mode: "create" });
          return;
        }
      }

      // Else: connect to hover target if present
      if (drag.hoverTarget && exists(drag.hoverTarget) && drag.hoverTarget.id() !== editState.linkSource.id()) {
        drag.altDrag.armed = false;
        drag.altDrag.sourceId = null;
        openEdgeWizard(editState.linkSource, drag.hoverTarget, { mode: "create" });
      } else {
        // keep pending link; just stop preview
        drag.altDrag.armed = false;
        drag.altDrag.sourceId = null;
        stopPreview();
        window.showTransientMessage?.("Pick a target node (drag onto it) or press ESC to cancel.");
      }
    });

    // keep canvas in sync
    window.addEventListener("resize", () => {
      if (editState?.linkSource) {
        ensureLinkCanvas();
        resizeLinkCanvas();
        requestDraw();
      }
    });
  }

  // --- Public flow
  function beginManualLink(node) {
    cancelManualLink();
    editState.linkSource = node;
    node.addClass("highlight");
    updateLinkChip();
    ensureDragHooks();
    startPreview();
    window.showTransientMessage?.("Drag to a target node to connect… (Tip: Alt+Drag from node)");
  }

  function cancelManualLink() {
    if (editState?.linkSource) editState.linkSource.removeClass("highlight");
    editState.linkSource = null;
    updateLinkChip();
    setHoverTarget(null);
    stopPreview();
    drag.altDrag.armed = false;
    drag.altDrag.sourceId = null;
  }

  // --- Mutations via Undo/Redo actions
  function deleteEdge(edge) {
    if (!edge || !edge.nonempty || !edge.nonempty()) return;
    const d = { ...edge.data() };
    window.ONEXUS_UNDO?.do(window.ONEXUS_UNDO.actions.removeEdge(d.id, d));
    window.showTransientMessage?.("Edge deleted. (Undo: Ctrl/Cmd+Z)");
  }

  function reverseEdge(edge) {
    if (!edge || !edge.nonempty || !edge.nonempty()) return;
    const id = edge.data("id");
    window.ONEXUS_UNDO?.do(window.ONEXUS_UNDO.actions.reverseEdge(id));
    window.showTransientMessage?.("Edge direction reversed. (Undo: Ctrl/Cmd+Z)");
  }

  function uniqueEdgeId(base) {
    let id = base, k = 1;
    const existsId = () => {
      const col = cy.getElementById(id);
      return col && col.nonempty && col.nonempty();
    };
    while (existsId()) { k += 1; id = `${base}-${k}`; }
    return id;
  }

  function openEdgeWizard(sourceNode, targetNode, opts = {}) {
    const mode = opts.mode ?? "create";
    const existingEdge = opts.edge ?? null;

    const srcId = sourceNode.id(), tgtId = targetNode.id();
    const typeOpts = [...new Set(cy.edges().map(e => e.data("type")))].filter(Boolean);
    const dimOpts = [...new Set(cy.edges().map(e => e.data("dimension")))].filter(Boolean);

    const typeOptions = typeOpts.length ? typeOpts : ["Controls", "Supplies", "LocatedIn", "DesignedBy", "BuiltBy", "ProvidedBy", "PartOfSystem"];
    const dimOptions = dimOpts.length ? dimOpts : (DIMENSION_DEFAULTS ?? ["System", "Spatial", "Responsibility", "Vendor"]);

    const defaultDim =
      (sourceNode.data("nodeType") === "Space" || targetNode.data("nodeType") === "Space")
        ? "Spatial"
        : (dimOpts[0] ?? "System");

    let overlay = document.getElementById("onexus-edge-wizard");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "onexus-edge-wizard";
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10060
      });
      document.body.appendChild(overlay);
    }

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "#fff",
      minWidth: "360px",
      maxWidth: "440px",
      borderRadius: "8px",
      padding: "12px",
      boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
      fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      fontSize: "13px",
      color: "#111"
    });

    const title = mode === "edit" ? "Edit relation" : "Create relation";
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">${title}</div>
      <div style="margin-bottom:6px;"><b>From:</b> ${sourceNode.data("displayLabel") ?? srcId}</div>
      <div style="margin-bottom:10px;"><b>To:</b> ${targetNode.data("displayLabel") ?? tgtId}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <label>Type
          <select id="rel-type" style="width:100%;margin-top:4px;">
            ${typeOptions.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </label>
        <label>Dimension
          <select id="rel-dim" style="width:100%;margin-top:4px;">
            ${dimOptions.map(d => `<option value="${d}">${d}</option>`).join("")}
          </select>
        </label>
      </div>

      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <input id="rel-dir" type="checkbox" checked> Directional (source → target)
      </label>

      <label style="display:block;margin-bottom:10px;">
        <div style="margin-bottom:4px;">Notes (optional)</div>
        <textarea id="rel-notes" rows="3" style="width:100%;"></textarea>
      </label>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="rel-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        <button id="rel-apply" style="padding:6px 10px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer;">${mode === "edit" ? "Save" : "Create"}</button>
      </div>
    `;

    overlay.innerHTML = "";
    overlay.appendChild(panel);

    const $type = panel.querySelector("#rel-type");
    const $dim = panel.querySelector("#rel-dim");
    const $dir = panel.querySelector("#rel-dir");
    const $notes = panel.querySelector("#rel-notes");

    if (mode === "edit" && existingEdge) {
      const d = existingEdge.data();
      if ([...$type.options].some(o => o.value === d.type)) $type.value = d.type;
      if ([...$dim.options].some(o => o.value === d.dimension)) $dim.value = d.dimension;
      else $dim.value = d.dimension ?? defaultDim;
      $dir.checked = !!d.directional;
      $notes.value = d.notes ?? "";
    } else {
      $dim.value = defaultDim;
      $dir.checked = true;
      $notes.value = "";
    }

    const close = () => { overlay.remove(); cancelManualLink(); };

    panel.querySelector("#rel-cancel").addEventListener("click", close);
    panel.querySelector("#rel-apply").addEventListener("click", () => {
      const type = $type.value;
      const dimension = $dim.value;
      const directional = $dir.checked;
      const notes = $notes.value ?? "";

      if (mode === "edit" && existingEdge) {
        const before = existingEdge.data();
        const afterPatch = { type, dimension, directional: !!directional, notes };
        window.ONEXUS_UNDO?.do(window.ONEXUS_UNDO.actions.editEdge(before.id, before, afterPatch));
        window.showTransientMessage?.("Relation updated. (Undo: Ctrl/Cmd+Z)");
        close();
        return;
      }

      const dup = cy.edges().filter(e =>
        e.data("source") === srcId &&
        e.data("target") === tgtId &&
        e.data("type") === type
      );
      if (dup.length > 0) { alert("An identical edge already exists."); return; }

      const id = uniqueEdgeId(`e_${srcId}_${type}_${tgtId}`);
      const edgeData = { id, type, dimension, directional: !!directional, source: srcId, target: tgtId, notes };
      window.ONEXUS_UNDO?.do(window.ONEXUS_UNDO.actions.addEdge(edgeData));
      window.showTransientMessage?.(`Added: ${type} (${edgeData.source} → ${edgeData.target}) (Undo: Ctrl/Cmd+Z)`);
      close();
    });
  }

  // ESC cancels
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") cancelManualLink();
  });

  // expose
  window.openEdgeWizard = openEdgeWizard;
  window.__onexusLink = { beginManualLink, cancelManualLink, deleteEdge, reverseEdge };
})();
