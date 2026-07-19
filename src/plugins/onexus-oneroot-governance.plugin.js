/* ONEXUS Plugin – OneRoot governed relationship loop
   Keeps review actions explicit, auditable, and session-local. */
(function () {
    const api = {};
    const now = () => new Date().toISOString();
    const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);

    function currentRelationship(edge) {
        const data = edge?.data?.() ?? edge?.data ?? {};
        const normalize = window.ONEXUS?.import?.normalizeRelationship;
        return typeof normalize === "function" ? normalize(data) : (isObject(data.relationship) ? data.relationship : {});
    }

    function auditEntry(action, before, reviewer, note) {
        return { action, at: now(), by: String(reviewer || "Human reviewer"), note: String(note || ""), before };
    }

    function reviewEdge(edgeId, decision = {}) {
        const edge = window.cy?.getElementById(String(edgeId || ""));
        if (!edge?.nonempty?.()) return { ok: false, reason: `Edge '${edgeId}' not found.` };
        const before = currentRelationship(edge);
        if (before.truthClass !== "inferred" && decision.action === "approve") {
            return { ok: false, reason: "Only inferred proposals require promotion." };
        }
        const action = decision.action === "reject" ? "reject" : "approve";
        const relationship = {
            ...before,
            truthClass: action === "approve" ? "governed" : "inferred",
            review: {
                ...(before.review || {}),
                status: action === "approve" ? "approved" : "rejected",
                reviewedBy: String(decision.reviewer || "Human reviewer"),
                reviewedAt: now(),
                note: String(decision.note || ""),
            },
            audit: [...(Array.isArray(before.audit) ? before.audit : []), auditEntry(action, {
                truthClass: before.truthClass,
                review: before.review,
            }, decision.reviewer, decision.note)],
        };
        edge.data("relationship", relationship);
        edge.data("truthClass", relationship.truthClass);
        try { window.ONEXUS?.bus?.emit?.("relationshipReviewed", { edgeId: edge.id(), action, relationship }); } catch { }
        try { window.ONEXUS_RELATIONSHIP_INTELLIGENCE?.refresh?.(); } catch { }
        return { ok: true, edgeId: edge.id(), action, relationship };
    }

    function applyOneRootDefaults(graph) {
        const meta = graph?.meta ?? graph?.metadata ?? {};
        const sourceText = `${meta.source || ""} ${meta.importer || ""} ${graph?.schema || ""}`.toLowerCase();
        if (!sourceText.includes("oneroot")) return graph;
        (graph?.elements?.edges || []).forEach(edge => {
            const data = edge?.data || {};
            if (data.relationship) return;
            const isDependency = String(data.type || data.edgeType).toLowerCase() === "requires";
            data.relationship = {
                contract: "onexus.relationship.v1",
                truthClass: isDependency ? "decision-created" : "project-defined",
                source: { system: "OneRoot", recordId: data.id || "", url: "" },
                provenance: { method: "OneRoot export", evidenceIds: [], observedAt: meta.generatedAt || "" },
                confidence: "Explicit",
                validity: { from: meta.generatedAt || "", to: "", status: "active" },
                review: { status: "reviewed", reviewedBy: "OneRoot export", reviewedAt: meta.generatedAt || "" },
                lifecycle: { deleted: false, deletedAt: "" },
            };
            data.truthClass = data.relationship.truthClass;
        });
        graph.meta = { ...meta, importer: meta.importer || "oneroot-governed-package", sourceSystem: "OneRoot", governancePackage: meta.governancePackage || "oneroot.governance.v1" };
        return graph;
    }

    function selectedProposal() {
        return window.cy?.edges(":selected").filter(edge => currentRelationship(edge).truthClass === "inferred").first();
    }

    function ensureReviewCard() {
        const panel = document.getElementById("panelRelationshipIntelligence");
        if (!panel || document.getElementById("onxGovernanceReview")) return;
        const card = document.createElement("div");
        card.id = "onxGovernanceReview";
        card.className = "onx-ri-card";
        card.hidden = true;
        card.innerHTML = '<strong>Review inferred relationship</strong><span id="onxGovernanceLabel"></span><div class="onx-ri-segment" style="margin-top:8px"><button type="button" data-review="reject">Reject</button><button type="button" data-review="approve">Approve</button></div>';
        panel.appendChild(card);
        card.addEventListener("click", event => {
            const action = event.target.dataset.review;
            if (!action) return;
            const edge = selectedProposal();
            if (!edge?.nonempty?.()) return;
            reviewEdge(edge.id(), { action, reviewer: "ONEXUS user" });
            renderSelection();
        });
    }

    function renderSelection() {
        ensureReviewCard();
        const card = document.getElementById("onxGovernanceReview");
        const label = document.getElementById("onxGovernanceLabel");
        if (!card || !label) return;
        const edge = selectedProposal();
        card.hidden = !edge?.nonempty?.();
        if (edge?.nonempty?.()) label.textContent = `${edge.data("displayType") || edge.data("type")} · ${edge.source().data("displayLabel")} → ${edge.target().data("displayLabel")}`;
    }

    function boot() {
        ensureReviewCard();
        window.cy?.on?.("select unselect", "edge", renderSelection);
    }

    Object.assign(api, { currentRelationship, reviewEdge, applyOneRootDefaults });
    window.ONEXUS_ONEROOT_GOVERNANCE = api;
    try { window.ONEXUS?.bus?.on?.("graphWillLoad", event => applyOneRootDefaults(event.detail?.graph || event.graph)); } catch { }

    const ONX = window.ONEXUS;
    if (ONX?.registerPlugin) ONX.registerPlugin({ id: "oneroot-governance", title: "OneRoot Governance Loop", register() { boot(); } });
})();
