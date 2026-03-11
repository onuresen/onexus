/* =========================================================
 ONEXUS – Plugin Explanation Bridge (details panel augmentation)
 - Does NOT fork graph-core.state.js
 - Wraps updateDetailsForNode / updateDetailsForEdge and appends plugin HTML
 - Reads templates from: ONEXUS.plugins.explanations (Map)

 Template shapes supported:
 A) function(ctx) -> htmlString
 B) { label?, when?(ctx)->bool, render(ctx)->htmlString, order?, appliesTo?: 'node'|'edge'|'both' }

 Matching rules:
 - If template key equals edge.type, it matches that edge
 - If template key equals node.nodeType or node.category, it matches that node
 - If template.when exists, it must return true
========================================================= */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX) return;

    function getDetailsEl() {
        return document.getElementById("details") || document.getElementById("onxFloatDetailsBody");
    }

    function removeOldExplain(el) {
        try {
            const old = el.querySelector("#onx-plugin-explain");
            if (old) old.remove();
        } catch { }
    }

    // ✅ canonical safe escape
    function escapeHtml(s) {
        const fn = window.ONEXUS?.util?.escapeHtml;
        return (typeof fn === "function") ? fn(s) : String(s ?? "");
    }

    function normalizeTplEntry(key, value) {
        const id = String(key ?? "");
        if (typeof value === "function") {
            return { id, order: 100, appliesTo: "both", label: null, when: null, render: value };
        }
        if (value && typeof value === "object") {
            return {
                id,
                order: Number.isFinite(value.order) ? value.order : 100,
                appliesTo: value.appliesTo ?? "both",
                label: value.label ?? null,
                when: (typeof value.when === "function") ? value.when : null,
                render: (typeof value.render === "function") ? value.render : null
            };
        }
        return null;
    }

    function entriesFromExplanationMap() {
        const map = ONX.plugins?.explanations;
        if (!map) return [];
        const out = [];
        try {
            if (map instanceof Map) {
                for (const [k, v] of map.entries()) {
                    const e = normalizeTplEntry(k, v);
                    if (e && e.render) out.push(e);
                }
            } else if (typeof map === "object") {
                for (const k of Object.keys(map)) {
                    const e = normalizeTplEntry(k, map[k]);
                    if (e && e.render) out.push(e);
                }
            }
        } catch (e) {
            console.warn("[ONEXUS explain] Failed to read explanations", e);
        }
        return out;
    }

    function matchTemplate(e, ctx) {
        const kind = ctx.kind;
        const a = String(e.appliesTo ?? "both").toLowerCase();
        if (a !== "both" && a !== kind) return false;

        const key = e.id;
        if (kind === "edge") {
            const t = String(ctx.data?.type ?? "");
            if (key === t) return true;
        } else {
            const nt = String(ctx.data?.nodeType ?? "");
            const cat = String(ctx.data?.category ?? ctx.data?.revitCategory ?? "");
            if (key === nt || key === cat) return true;
        }

        if (e.when) {
            try { return !!e.when(ctx); } catch { return false; }
        }
        return false;
    }

    function renderExplanations(kind, ele) {
        const templates = entriesFromExplanationMap();
        if (!templates.length) return "";
        const data = ele?.data?.() ?? {};
        const ctxBase = {
            kind,
            cy: window.cy,
            ele,
            data,
            state: window.__onexus_state,
            meta: window.__onexus_meta,
            util: ONX.util || {}
        };

        const matches = [];
        for (const tpl of templates) {
            let ok = false;
            try {
                ok = matchTemplate(tpl, ctxBase) || (tpl.when ? !!tpl.when(ctxBase) : false);
            } catch {
                ok = false;
            }
            if (ok) matches.push(tpl);
        }
        if (!matches.length) return "";

        matches.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));

        const blocks = [];
        for (const m of matches) {
            let html = "";
            try { html = String(m.render(ctxBase) ?? ""); } catch { html = ""; }
            if (!html.trim()) continue;
            const title = m.label ? escapeHtml(m.label) : escapeHtml(m.id);
            blocks.push(`
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);">
          <div style="font-size:11px;font-weight:900;letter-spacing:.02em;color:var(--text-muted);margin-bottom:6px;">
            ${title}
          </div>
          <div style="font-size:12px;line-height:1.45;color:var(--text-main);">
            ${html}
          </div>
        </div>
      `);
        }
        if (!blocks.length) return "";

        return `
      <div id="onx-plugin-explain">
        ${blocks.join("")}
      </div>
    `;
    }

    function appendExplain(kind, ele) {
        const el = getDetailsEl();
        if (!el) return;
        removeOldExplain(el);
        const html = renderExplanations(kind, ele);
        if (!html) return;
        try {
            el.insertAdjacentHTML("beforeend", html);
            ONX.bus?.emit?.("explainRendered", { kind, id: ele?.id?.(), data: ele?.data?.() });
        } catch (e) {
            console.warn("[ONEXUS explain] append failed", e);
        }
    }

    function wrapOnce() {
        if (window.__onxExplainWrapped) return;
        window.__onxExplainWrapped = true;

        const origNode = window.updateDetailsForNode;
        const origEdge = window.updateDetailsForEdge;

        if (typeof origNode === "function") {
            window.updateDetailsForNode = function (node) {
                origNode(node);
                try { appendExplain("node", node); } catch { }
            };
        }

        if (typeof origEdge === "function") {
            window.updateDetailsForEdge = function (edge) {
                origEdge(edge);
                try { appendExplain("edge", edge); } catch { }
            };
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(wrapOnce, 0));
    } else {
        setTimeout(wrapOnce, 0);
    }
})();