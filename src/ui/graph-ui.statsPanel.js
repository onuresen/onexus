// ONEXUS – Stats Panel
// Populates #onxStatsSummary (inside Filter drawer) with live category + edge-type counts.
(function () {
    const esc = (s) => {
        const fn = window.ONEXUS?.util?.escapeHtml;
        return typeof fn === "function" ? fn(s) : String(s ?? "");
    };

    function row(label, value) {
        return `<div style="display:flex;justify-content:space-between;gap:8px;padding:1px 0;">
          <span>${esc(label)}</span><b>${esc(String(value))}</b>
        </div>`;
    }

    function renderStats() {
        const box = document.getElementById("onxStatsSummary");
        if (!box) return;

        const cy = window.cy;
        if (!cy || !cy.nodes().length) {
            box.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Load a graph to see stats.</span>';
            return;
        }

        const visNodes = cy.nodes(":visible");
        const visEdges = cy.edges(":visible");
        const total = cy.nodes().length;
        const isolated = visNodes.filter(n => n.connectedEdges(":visible").length === 0).length;

        // Category breakdown
        const catMap = new Map();
        visNodes.forEach(n => {
            const cat = String(n.data("category") || "Uncategorized");
            catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
        });
        const catRows = [...catMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([cat, cnt]) => row(cat, cnt))
            .join("");

        // Edge type breakdown
        const typeMap = new Map();
        visEdges.forEach(e => {
            const t = String(e.data("displayType") || e.data("type") || "—");
            typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
        });
        const typeRows = [...typeMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([t, cnt]) => row(t, cnt))
            .join("");

        box.innerHTML = `
          <div style="margin-bottom:8px;">
            <div style="font-weight:600;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">
              Nodes ${visNodes.length !== total ? `(${visNodes.length} visible / ${total} total)` : `(${total})`}
            </div>
            <div style="font-size:12px;line-height:1.55;">${catRows || "—"}</div>
            ${isolated > 0 ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted);">${isolated} isolated</div>` : ""}
          </div>
          ${typeRows ? `<div>
            <div style="font-weight:600;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">
              Edge types (${visEdges.length})
            </div>
            <div style="font-size:12px;line-height:1.55;">${typeRows}</div>
          </div>` : ""}
        `;
    }

    function boot() {
        try {
            window.ONEXUS?.bus?.on?.("graphLoaded", () => setTimeout(renderStats, 80));
        } catch { }

        // Stay in sync when filters change (updateMetrics is called after every filter op)
        const orig = window.updateMetrics;
        if (typeof orig === "function" && !orig.__statsPanelWrapped) {
            window.updateMetrics = function () {
                orig.apply(this, arguments);
                try { renderStats(); } catch { }
            };
            window.updateMetrics.__statsPanelWrapped = true;
        }

        renderStats();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
