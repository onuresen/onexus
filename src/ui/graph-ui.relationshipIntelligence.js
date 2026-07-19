/* ONEXUS – Relationship Intelligence Mode */
(function () {
    const state = { term: "", nonMatching: "dim", depth: 3, rootId: "", historyIndex: -1, dates: [], timer: null };
    const esc = (value) => window.ONEXUS?.util?.escapeHtml?.(value) ?? "";
    const byId = (id) => document.getElementById(id);

    function relationshipOf(edge) {
        return edge.data("relationship") || {};
    }

    function truthClass(edge) {
        return relationshipOf(edge).truthClass || edge.data("truthClass") || (String(edge.data("confidence")).toLowerCase() === "inferred" ? "inferred" : "source-native");
    }

    function datedValue(edge) {
        const rel = relationshipOf(edge);
        return rel.validity?.from || rel.provenance?.observedAt || edge.data("createdAt") || edge.data("timestamp") || "";
    }

    function matchingNodes() {
        const cy = window.cy;
        if (!cy) return null;
        if (!state.term) return cy.nodes();
        const term = state.term.toLowerCase();
        return cy.nodes().filter(node => [node.data("displayLabel"), node.data("id"), node.data("category"), node.data("nodeType")]
            .some(value => String(value ?? "").toLowerCase().includes(term)));
    }

    function impactElements() {
        const cy = window.cy;
        const root = cy?.getElementById(state.rootId);
        if (!cy || !root?.nonempty?.() || state.depth === 0) return null;
        if (state.depth === "all") return cy.elements();
        let nodes = root;
        let frontier = root;
        for (let i = 0; i < state.depth; i += 1) {
            const next = frontier.neighborhood("node").not(nodes);
            nodes = nodes.union(next);
            frontier = next;
        }
        return nodes.union(nodes.connectedEdges());
    }

    function applyView() {
        const cy = window.cy;
        if (!cy) return;
        const matches = matchingNodes();
        const impact = impactElements();
        cy.batch(() => {
            cy.elements().removeClass("ri-dim ri-hide ri-impact ri-root ri-history-hide");
            let relevant = cy.elements();
            if (state.term) relevant = matches.union(matches.connectedEdges());
            if (impact) relevant = relevant.intersection(impact);
            if (state.term || impact) cy.elements().not(relevant).addClass(state.nonMatching === "hide" ? "ri-hide" : "ri-dim");
            if (impact) impact.addClass("ri-impact");
            if (state.rootId) cy.getElementById(state.rootId).addClass("ri-root");
            if (state.historyIndex >= 0 && state.dates.length) {
                const cutoff = state.dates[state.historyIndex];
                cy.edges().filter(edge => datedValue(edge) && datedValue(edge) > cutoff).addClass("ri-history-hide");
                cy.nodes().filter(node => node.connectedEdges().length && node.connectedEdges().every(edge => edge.hasClass("ri-history-hide"))).addClass("ri-history-hide");
            }
        });
        const count = byId("onxRiSearchCount");
        if (count) count.textContent = state.term ? `${matches.length} matching item${matches.length === 1 ? "" : "s"}` : "All items shown";
        const reach = byId("onxRiReach");
        if (reach) reach.textContent = impact ? `${impact.nodes().length} nodes / ${impact.edges().length} links` : (state.rootId ? "Impact off" : "Select a node");
    }

    function renderQuality() {
        const cy = window.cy;
        const host = byId("onxRiQuality");
        if (!cy || !host) return;
        const linked = cy.nodes().filter(node => node.degree() > 0).length;
        const orphans = cy.nodes().length - linked;
        const deleted = cy.edges().filter(edge => relationshipOf(edge).lifecycle?.deleted === true || edge.data("deletedReference") === true).length;
        const rate = cy.nodes().length ? Math.round((linked / cy.nodes().length) * 100) : 0;
        host.innerHTML = `<strong>Data health</strong><div class="onx-ri-metric-grid"><div class="onx-ri-metric"><b>${rate}%</b><span>link rate</span></div><div class="onx-ri-metric"><b>${orphans}</b><span>orphans</span></div><div class="onx-ri-metric"><b>${deleted}</b><span>deleted refs</span></div></div>`;
    }

    function renderTruth() {
        const cy = window.cy;
        const host = byId("onxRiTruth");
        if (!cy || !host) return;
        const counts = new Map();
        cy.edges().forEach(edge => counts.set(truthClass(edge), (counts.get(truthClass(edge)) || 0) + 1));
        host.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `<div class="onx-ri-row"><i></i><span style="margin-left:0">${esc(name)}</span><span>${count}</span></div>`).join("") || '<span class="onx-ri-label">No relationships</span>';
    }

    function focusNode(id) {
        const node = window.cy?.getElementById(id);
        if (!node?.nonempty?.()) return;
        window.cy.nodes().unselect();
        node.select();
        state.rootId = id;
        applyView();
        window.cy.animate({ fit: { eles: impactElements() || node, padding: 70 }, duration: 250 });
        renderDeepLink(node);
    }

    function renderHotspots() {
        const cy = window.cy;
        const host = byId("onxRiHotspots");
        if (!cy || !host) return;
        host.replaceChildren();
        [...cy.nodes()].sort((a, b) => b.degree() - a.degree()).slice(0, 6).forEach((node, index) => {
            const row = document.createElement("div"); row.className = "onx-ri-row";
            const button = document.createElement("button"); button.type = "button"; button.textContent = `${index + 1}. ${node.data("displayLabel") || node.id()}`; button.addEventListener("click", () => focusNode(node.id()));
            const count = document.createElement("span"); count.textContent = node.degree();
            row.append(button, count); host.appendChild(row);
        });
    }

    function renderDeepLink(node) {
        const link = byId("onxRiDeepLink");
        if (!link) return;
        const source = node?.data("source") || {};
        const url = node?.data("externalUrl") || node?.data("webView") || source.url || "";
        link.hidden = !url;
        if (url) link.href = url;
    }

    function setupHistory() {
        const cy = window.cy;
        state.dates = [...new Set(cy?.edges().map(datedValue).filter(Boolean) || [])].sort();
        state.historyIndex = state.dates.length ? state.dates.length - 1 : -1;
        const slider = byId("onxRiHistory");
        if (slider) { slider.max = Math.max(0, state.dates.length - 1); slider.value = Math.max(0, state.historyIndex); slider.disabled = !state.dates.length; }
        updateHistoryLabel();
    }

    function updateHistoryLabel() {
        const label = byId("onxRiHistoryLabel");
        if (label) label.textContent = state.historyIndex >= 0 ? `Showing relationships through ${state.dates[state.historyIndex]}` : "No dated relationships";
    }

    function refresh() { renderQuality(); renderTruth(); renderHotspots(); setupHistory(); applyView(); }

    function reset() {
        state.term = ""; state.rootId = ""; state.historyIndex = state.dates.length ? state.dates.length - 1 : -1;
        const input = byId("onxRiSearch"); if (input) input.value = "";
        if (state.timer) clearInterval(state.timer);
        renderDeepLink(null); updateHistoryLabel(); applyView();
    }

    function boot() {
        const cy = window.cy;
        if (!cy || !byId("panelRelationshipIntelligence")) return;
        try { cy.style().selector(".ri-dim").style({ opacity: 0.1 }).selector(".ri-hide, .ri-history-hide").style({ display: "none" }).selector("node.ri-root").style({ "border-width": 5, "border-color": "#2563eb" }).selector(".ri-impact").style({ opacity: 1 }).update(); } catch { }
        byId("onxRiSearch")?.addEventListener("input", event => { state.term = event.target.value.trim(); applyView(); });
        byId("onxRiReset")?.addEventListener("click", reset);
        byId("onxRiNonMatching")?.addEventListener("click", event => { const mode = event.target.dataset.mode; if (!mode) return; state.nonMatching = mode; event.currentTarget.querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.mode === mode)); applyView(); });
        byId("onxRiDepth")?.addEventListener("click", event => { const raw = event.target.dataset.depth; if (!raw) return; state.depth = raw === "all" ? "all" : Number(raw); event.currentTarget.querySelectorAll("button").forEach(button => button.classList.toggle("active", button === event.target)); applyView(); });
        byId("onxRiHistory")?.addEventListener("input", event => { state.historyIndex = Number(event.target.value); updateHistoryLabel(); applyView(); });
        byId("onxRiHistoryPlay")?.addEventListener("click", () => { if (!state.dates.length) return; if (state.timer) { clearInterval(state.timer); state.timer = null; return; } state.historyIndex = 0; state.timer = setInterval(() => { if (state.historyIndex >= state.dates.length - 1) { clearInterval(state.timer); state.timer = null; return; } state.historyIndex += 1; byId("onxRiHistory").value = state.historyIndex; updateHistoryLabel(); applyView(); }, 700); });
        cy.on("select", "node", event => { state.rootId = event.target.id(); renderDeepLink(event.target); applyView(); });
        cy.on("unselect", "node", () => { if (!cy.nodes(":selected").length) { state.rootId = ""; renderDeepLink(null); applyView(); } });
        try { window.ONEXUS?.bus?.on?.("graphLoaded", () => setTimeout(refresh, 100)); } catch { }
        refresh();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
    window.ONEXUS_RELATIONSHIP_INTELLIGENCE = { state, refresh, reset, focusNode };
})();
