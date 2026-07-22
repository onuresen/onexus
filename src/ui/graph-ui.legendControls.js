/* =========================================================
ONEXUS – Legend Controls (Top-right checkboxes)
ROBUST FIX:
- Ensures #legendControls exists (creates it if missing)
- Ensures #toggleEdgeLabels and #toggleNodeLabels exist in that container
- Wires to setEdgeLabelVisibility / setNodeLabelVisibility
Works for both layouts without duplicating IDs
========================================================= */
(function () {
    const $ = (id) => document.getElementById(id);

    function ensureLegendControlsHost() {
        // Preferred: left-rail overlay host (top-right)
        let host = $("legendControls");
        if (host) return host;

        // If legendOverlay exists, create legendControls inside it (matches layout-leftRail.css)
        const overlay = $("legendOverlay");
        if (overlay) {
            host = document.createElement("div");
            host.id = "legendControls";
            host.setAttribute("aria-label", "Legend controls");
            // Insert at top of overlay
            overlay.insertBefore(host, overlay.firstChild);
            return host;
        }

        // Fallback: if #legend exists anywhere, inject a controls div right before it
        const legend = $("legend");
        if (legend && legend.parentElement) {
            host = document.createElement("div");
            host.id = "legendControls";
            host.setAttribute("aria-label", "Legend controls");
            legend.parentElement.insertBefore(host, legend);
            return host;
        }

        return null;
    }

    function ensureLabel(textNode, text) {
        textNode.textContent = text;
    }

    function ensureCheckbox(id, labelText, defaultChecked) {
        // If already exists elsewhere, do not recreate (avoid duplicate IDs)
        const existing = $(id);
        if (existing) return existing;

        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.checked = !!defaultChecked;

        const txt = document.createTextNode("");
        ensureLabel(txt, " " + labelText);

        label.appendChild(cb);
        label.appendChild(txt);

        return { label, cb };
    }

    function wire(cb, handler) {
        if (!cb || cb.__onxHooked) return;
        cb.__onxHooked = true;
        cb.addEventListener("change", () => handler(cb.checked));
    }

    function syncFromState(edgeCb, nodeCb) {
        const st = window.__onexus_state;
        if (!st) return;
        if (edgeCb) edgeCb.checked = !!st.showEdgeLabels;
        if (nodeCb) nodeCb.checked = !!st.showNodeLabels;
    }

    function render() {
        const host = ensureLegendControlsHost();
        if (!host) return;

        // If checkboxes already exist in DOM (classic sidebar), just wire + sync and ensure they are in host if possible.
        const existingEdge = $("toggleEdgeLabels");
        const existingNode = $("toggleNodeLabels");

        // If existing are NOT inside our host and host is empty, we can move them here safely
        // BUT moving might affect classic layout; so only move when host is empty AND the existing ones are not inside visible sidebar.
        // Safer: don't move existing, just ensure host has them.
        const st = window.__onexus_state || {};

        const existingInside = $("toggleLabelsInside");

        const edge = existingEdge ? existingEdge : ensureCheckbox("toggleEdgeLabels", "Show edge labels", st.showEdgeLabels !== false);
        const node = existingNode ? existingNode : ensureCheckbox("toggleNodeLabels", "Show node labels", st.showNodeLabels !== false);
        const labelsInside = window.ONEXUS?.style?.getNodeLabelPosition?.() !== "outside";
        const inside = existingInside ? existingInside : ensureCheckbox("toggleLabelsInside", "Labels inside nodes", labelsInside);

        // If ensureCheckbox returned objects, append label wrappers; else create wrappers if needed
        host.innerHTML = "";

        if (edge && edge.cb) host.appendChild(edge.label);
        else if (edge instanceof HTMLInputElement) {
            // Wrap existing input in a label for consistent styling in legendControls
            const lab = document.createElement("label");
            lab.appendChild(edge);
            lab.appendChild(document.createTextNode(" Show edge labels"));
            host.appendChild(lab);
        }

        if (node && node.cb) host.appendChild(node.label);
        else if (node instanceof HTMLInputElement) {
            const lab = document.createElement("label");
            lab.appendChild(node);
            lab.appendChild(document.createTextNode(" Show node labels"));
            host.appendChild(lab);
        }

        if (inside && inside.cb) host.appendChild(inside.label);
        else if (inside instanceof HTMLInputElement) {
            const lab = document.createElement("label");
            lab.appendChild(inside);
            lab.appendChild(document.createTextNode(" Labels inside nodes"));
            host.appendChild(lab);
        }

        const edgeCb = $("toggleEdgeLabels");
        const nodeCb = $("toggleNodeLabels");
        const insideCb = $("toggleLabelsInside");

        // Wire handlers to state methods (provided by graph-core.state.js)
        wire(edgeCb, (checked) => window.setEdgeLabelVisibility?.(checked));
        wire(nodeCb, (checked) => window.setNodeLabelVisibility?.(checked));
        // Checked = labels inside the node (default); unchecked = below the node.
        wire(insideCb, (checked) => window.ONEXUS?.style?.setNodeLabelPosition?.(checked ? "inside" : "outside"));

        // Sync initial state (graph-core.state.js keeps showEdgeLabels/showNodeLabels)
        syncFromState(edgeCb, nodeCb);
        if (insideCb) insideCb.checked = window.ONEXUS?.style?.getNodeLabelPosition?.() !== "outside";
    }

    function boot() {
        render();

        // Re-render after modules potentially rebuild overlays/DOM
        setTimeout(render, 120);
        setTimeout(render, 450);

        // Also re-render on graph load/edit stabilization
        const cy = window.cy;
        if (cy && !cy.__onxLegendControlsHooked) {
            cy.__onxLegendControlsHooked = true;
            cy.on("add remove layoutstop", () => setTimeout(render, 0)); // safe
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
})();