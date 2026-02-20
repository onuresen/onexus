/* =========================================================
ONEXUS – Hook Audit (Cytoscape + optional DOM listener audit)
- Safe: records hook registrations; does NOT mutate main graph elements
- Wraps:
  - window.cy.on / window.cy.one  (always available once cy exists)
  - EventTarget.prototype.addEventListener (optional; dom:false by default)
Exports:
  window.ONEXUS_HOOK_AUDIT = { install, run, buildGraph, exportJSON, _state }
========================================================= */
(function () {
    const NS = (window.ONEXUS_HOOK_AUDIT = window.ONEXUS_HOOK_AUDIT || {});
    const TS = () => new Date().toISOString();

    const state = (NS._state = NS._state || {
        installed: { cy: false, dom: false },
        originals: { cyOn: null, cyOne: null, addEventListener: null },
        records: { cy: [], dom: [] },
    });

    function safeStackModuleHint() {
        try {
            const stack = new Error().stack || "";
            const lines = stack.split("\n").slice(2, 12);
            // pick first ".js" file-ish token
            for (const L of lines) {
                const m = L.match(/(\/[^)\s]+\.js)(:\d+:\d+)?/);
                if (m && m[1]) return m[1].split("/").slice(-1)[0];
                const m2 = L.match(/([A-Za-z0-9._-]+\.js)(:\d+:\d+)?/);
                if (m2 && m2[1]) return m2[1];
            }
            return "unknown";
        } catch {
            return "unknown";
        }
    }

    function safeFnName(fn) {
        try {
            return (fn && (fn.name || fn.displayName)) ? String(fn.name || fn.displayName) : "";
        } catch {
            return "";
        }
    }

    // ---- install wrappers ----
    NS.install = function install(opts = {}) {
        const { dom = false } = opts;
        const cy = window.cy;

        // CY wrapper
        if (cy && !state.installed.cy) {
            state.installed.cy = true;

            state.originals.cyOn = cy.on.bind(cy);
            state.originals.cyOne = (typeof cy.one === "function") ? cy.one.bind(cy) : null;

            function wrapCy(kind, original) {
                return function (event, selector, handler, ...rest) {
                    // cytoscape.on signature overloads; normalize
                    let evtName = event;
                    let sel = null;
                    let fn = null;

                    if (typeof selector === "function") {
                        fn = selector;
                    } else {
                        sel = selector ?? null;
                        fn = handler;
                    }

                    state.records.cy.push({
                        at: TS(),
                        kind,
                        event: String(evtName ?? ""),
                        selector: sel ? String(sel) : "",
                        handlerName: safeFnName(fn),
                        moduleHint: safeStackModuleHint(),
                    });

                    return original(event, selector, handler, ...rest);
                };
            }

            cy.on = wrapCy("on", state.originals.cyOn);
            if (state.originals.cyOne) cy.one = wrapCy("one", state.originals.cyOne);
        }

        // DOM wrapper (optional)
        if (dom && !state.installed.dom && typeof EventTarget !== "undefined") {
            state.installed.dom = true;
            const orig = EventTarget.prototype.addEventListener;
            state.originals.addEventListener = orig;

            EventTarget.prototype.addEventListener = function (type, listener, options) {
                try {
                    // only record real functions
                    const fn = (typeof listener === "function") ? listener : (listener && typeof listener.handleEvent === "function" ? listener.handleEvent : null);
                    const capture = !!(typeof options === "boolean" ? options : options && options.capture);
                    const targetName =
                        (this === window) ? "window" :
                            (this === document) ? "document" :
                                (this && this.tagName) ? this.tagName.toLowerCase() :
                                    (this && this.constructor && this.constructor.name) ? this.constructor.name :
                                        "EventTarget";

                    state.records.dom.push({
                        at: TS(),
                        target: targetName,
                        type: String(type ?? ""),
                        capture,
                        handlerName: safeFnName(fn),
                        moduleHint: safeStackModuleHint(),
                    });
                } catch {
                    // ignore
                }
                return orig.call(this, type, listener, options);
            };
        }

        return { ...state.installed };
    };

    // ---- reporting ----
    function topNByKey(arr, keyFn, topN) {
        const map = new Map();
        for (const r of arr) {
            const k = keyFn(r);
            map.set(k, (map.get(k) || 0) + 1);
        }
        const out = Array.from(map.entries())
            .map(([k, count]) => ({ k, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, Math.max(1, topN || 10));
        return out;
    }

    NS.run = function run(opts = {}) {
        const { includeStacks = false, topN = 25 } = opts;

        const cyRecords = state.records.cy.slice();
        const domRecords = state.records.dom.slice();

        const summary = {
            at: TS(),
            counts: {
                cyRecords: cyRecords.length,
                domRecords: domRecords.length,
            },
            cyTop: topNByKey(cyRecords, (r) => `${r.kind} ${r.event} ${r.selector || "any"}`, topN)
                .map((x) => ({ kind: x.k.split(" ")[0], event: x.k.split(" ")[1], selector: x.k.split(" ").slice(2).join(" "), count: x.count })),
            domTop: topNByKey(domRecords, (r) => `${r.target} ${r.type} ${r.capture ? "cap" : "bub"}`, topN)
                .map((x) => {
                    const parts = x.k.split(" ");
                    return { target: parts[0], type: parts[1], capture: parts[2] === "cap", count: x.count };
                }),
        };

        const report = {
            summary,
            records: {
                cy: cyRecords,
                dom: domRecords,
            },
        };

        if (includeStacks) {
            // placeholder (kept for compatibility with earlier shape)
            report.stacks = { note: "Stacks are not persisted in this build (moduleHint is stored)." };
        }

        console.groupCollapsed("%c[ONEXUS HOOK AUDIT]", "color:#10b981;font-weight:800;");
        console.log("summary:", summary);
        console.log("records.cy:", cyRecords);
        console.log("records.dom:", domRecords);
        console.groupEnd();

        return report;
    };

    // ---- graph builder (ONEXUS schema) ----
    NS.buildGraph = function buildGraph(opts = {}) {
        const topN = opts.topN ?? 25;
        const report = NS.run({ includeStacks: false, topN });

        const DG = window.ONEXUS_DEVGRAPH;
        if (!DG?.makeGraph) throw new Error("ONEXUS_DEVGRAPH common missing. Load onexus-devgraph.common.js first.");

        const graph = DG.makeGraph({
            kind: "onexus/hook-audit-graph",
            source: location.href,
            counts: report.summary?.counts ?? {},
            builtAt: TS(),
        });

        const cyRoot = "SYS_CYTOSCAPE";
        const domRoot = "SYS_DOM";
        DG.addNode(graph, { id: cyRoot, nodeType: "System", category: "Runtime", label: "Cytoscape Hooks" });
        DG.addNode(graph, { id: domRoot, nodeType: "System", category: "Runtime", label: "DOM Hooks" });

        const moduleId = (hint) => `FILE_${DG.idSafe(hint || "unknown")}`;
        const moduleLabel = (hint) => hint || "(unknown module)";

        // Cytoscape hook records
        (report.records?.cy ?? []).forEach((r, idx) => {
            if (r.kind !== "on" && r.kind !== "one") return;

            const mod = r.moduleHint || "unknown";
            const mid = moduleId(mod);
            DG.addNode(graph, { id: mid, nodeType: "File", category: "Module", label: moduleLabel(mod) });

            const eid = `HOOK_CY_${DG.idSafe(r.kind)}_${DG.idSafe(r.event)}_${DG.idSafe(r.selector || "any")}`;
            const lbl = r.selector ? `${r.kind} ${r.event} :: ${r.selector}` : `${r.kind} ${r.event}`;

            DG.addNode(graph, {
                id: eid,
                nodeType: "HookEvent",
                category: "Cytoscape",
                label: lbl,
                data: { handler: r.handlerName || "" },
            });

            DG.addEdge(graph, {
                id: `E_${DG.idSafe(mid)}_Registers_${DG.idSafe(eid)}_${idx}`,
                type: "Registers",
                dimension: "System",
                source: mid,
                target: eid,
                directional: true,
                data: { confidence: "Inferred", notes: r.handlerName ? `handler=${r.handlerName}` : "" },
            });

            DG.addEdge(graph, {
                id: `E_${DG.idSafe(cyRoot)}_Has_${DG.idSafe(eid)}_${idx}`,
                type: "Has",
                dimension: "System",
                source: cyRoot,
                target: eid,
                directional: true,
            });
        });

        // DOM hook records
        (report.records?.dom ?? []).forEach((r, idx) => {
            const mod = r.moduleHint || "unknown";
            const mid = moduleId(mod);
            DG.addNode(graph, { id: mid, nodeType: "File", category: "Module", label: moduleLabel(mod) });

            const did = `HOOK_DOM_${DG.idSafe(r.target)}_${DG.idSafe(r.type)}_${DG.idSafe(r.capture ? "cap" : "bub")}`;
            const lbl = `${r.target}.${r.type} (${r.capture ? "capture" : "bubble"})`;

            DG.addNode(graph, {
                id: did,
                nodeType: "HookEvent",
                category: "DOM",
                label: lbl,
                data: { handler: r.handlerName || "" },
            });

            DG.addEdge(graph, {
                id: `E_${DG.idSafe(mid)}_Registers_${DG.idSafe(did)}_${idx}`,
                type: "Registers",
                dimension: "System",
                source: mid,
                target: did,
                directional: true,
                data: { confidence: "Inferred", notes: r.handlerName ? `handler=${r.handlerName}` : "" },
            });

            DG.addEdge(graph, {
                id: `E_${DG.idSafe(domRoot)}_Has_${DG.idSafe(did)}_${idx}`,
                type: "Has",
                dimension: "System",
                source: domRoot,
                target: did,
                directional: true,
            });
        });

        return DG.ensureGraph(graph, { autoCreateEndpointNodes: true });
    };

    // ---- export ----
    NS.exportJSON = function exportJSON(opts = {}) {
        const format = opts.format ?? "onexus"; // "onexus" or "raw"
        const download = opts.download !== false; // default true
        const topN = opts.topN ?? 25;

        if (format === "raw") {
            const report = NS.run({ includeStacks: true, topN });
            if (download) {
                const name = `onexus-hook-audit_raw_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 800);
            }
            return report;
        }

        const g = NS.buildGraph({ topN });
        if (download) {
            const DG = window.ONEXUS_DEVGRAPH;
            const name = `onexus-hook-audit_graph_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            DG.downloadGraph(g, name);
        }
        return g;
    };

    // Auto-install CY wrapper once cy exists (safe)
    setTimeout(() => {
        try { NS.install({ dom: false }); } catch { }
    }, 0);
})();