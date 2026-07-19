/* ONEXUS MCP Bridge Plugin
   Connects to the local Python MCP WebSocket server (ws://localhost:8765).
   Dispatches graph control commands received from Claude to the live Cytoscape instance.

   Commands handled (sent as JSON from server.py):
     focus_node      { cmd, id }
     highlight_nodes { cmd, ids, color }
     filter_subgraph { cmd, ids }
     reset_view      { cmd }
     set_layout      { cmd, layout }
     load_focused_graph { cmd, nodes, edges, layout }
     get_live_graph_summary { cmd }
     search_live_nodes { cmd, query, limit }
     get_live_node { cmd, id }
     get_live_neighbors { cmd, id, depth, direction }
     get_live_grounded_path { cmd, source_id, target_id, allowed_truth_classes, include_rejected }
     highlight_live_nodes_by_label { cmd, query, limit, color, focus_first }
     select_random_live_nodes { cmd, count, color }

   Each command is acknowledged with { ack: cmd._id, ok: true|false }.
*/
(function () {
  const ONEXUS = window.ONEXUS;
  if (!ONEXUS || typeof ONEXUS.registerPlugin !== "function") {
    console.warn("[MCP-Bridge] ONEXUS not available — plugin loaded too early?");
    return;
  }

  ONEXUS.registerPlugin({
    id: "onexus-mcp-bridge",
    name: "ONEXUS MCP Bridge",
    version: "1.0.0",

    register(_api) {
      const WS_URL = "ws://localhost:8765";
      const RECONNECT_DELAY_MS = 4000;

      let ws = null;
      let indicator = null;
      let reconnectTimer = null;

      // ── Status indicator (small dot in bottom-right) ──────────────────────
      function createIndicator() {
        // Remove any old one
        document.getElementById("onx-mcp-indicator")?.remove();

        const el = document.createElement("div");
        el.id = "onx-mcp-indicator";
        Object.assign(el.style, {
          position: "fixed",
          bottom: "14px",
          right: "14px",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: "#6b7280",
          border: "1.5px solid rgba(255,255,255,0.3)",
          zIndex: "9999",
          cursor: "default",
          transition: "background 0.3s",
        });
        el.title = "ONEXUS MCP Bridge: disconnected";
        document.body.appendChild(el);
        return el;
      }

      function setIndicator(state) {
        if (!indicator) return;
        const colors = { connected: "#22c55e", disconnected: "#6b7280", error: "#ef4444" };
        indicator.style.background = colors[state] ?? colors.disconnected;
        indicator.title = `ONEXUS MCP Bridge: ${state}`;
        // Live "breathing" glow only while connected
        indicator.classList.toggle("onx-mcp-live", state === "connected");
      }

      // Brief flash when a live command arrives from Claude
      function pulseIndicator() {
        if (!indicator) return;
        indicator.classList.remove("onx-mcp-pulse");
        // force reflow so the animation can restart on rapid commands
        void indicator.offsetWidth;
        indicator.classList.add("onx-mcp-pulse");
        // remove after the flash so the connected "breathe" glow resumes
        clearTimeout(pulseIndicator._t);
        pulseIndicator._t = setTimeout(() => indicator?.classList.remove("onx-mcp-pulse"), 550);
      }

      // ── Command dispatcher ────────────────────────────────────────────────
      function ack(msgId, ok, extra) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ack: msgId, ok, ...(extra ?? {}) }));
        }
      }

      function getCy() {
        return window.cy;
      }

      function getLabel(data) {
        if (!data) return "";
        const label = data.displayLabel ?? data.label ?? data.name ?? data.title;
        if (typeof label === "string") return label;
        if (label && typeof label === "object") return label.en ?? label.jp ?? Object.values(label)[0] ?? "";
        return data.id ?? "";
      }

      function getTags(data) {
        if (!data) return [];
        return Array.isArray(data.tags) ? data.tags : [];
      }

      function nodeSummary(node) {
        const data = node.data();
        return {
          id: node.id(),
          label: getLabel(data),
          category: data.category ?? "",
          nodeType: data.nodeType ?? "",
          status: data.status ?? "",
          tags: getTags(data),
          degree: node.degree(false),
          visible: node.visible(),
          selected: node.selected(),
        };
      }

      function edgeSummary(edge) {
        const data = edge.data();
        return {
          id: edge.id(),
          source: edge.source().id(),
          target: edge.target().id(),
          type: data.type ?? data.label ?? "",
          dimension: data.dimension ?? "",
        };
      }

      function groundedEdgeSummary(edge) {
        const data = edge.data();
        const normalize = window.ONEXUS?.import?.normalizeRelationship;
        const relationship = typeof normalize === "function" ? normalize(data) : (data.relationship || {});
        return {
          ...edgeSummary(edge),
          truthClass: relationship.truthClass,
          sourceRecord: relationship.source || {},
          provenance: relationship.provenance || {},
          confidence: relationship.confidence,
          validity: relationship.validity || {},
          review: relationship.review || {},
          lifecycle: relationship.lifecycle || {},
        };
      }

      function searchNodes(cy, query, limit) {
        const q = String(query ?? "").toLowerCase();
        const max = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const results = [];
        cy.nodes().forEach(node => {
          if (results.length >= max) return;
          const data = node.data();
          const haystack = [
            node.id(),
            getLabel(data),
            data.category,
            data.nodeType,
            data.status,
            ...getTags(data),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (haystack.includes(q)) results.push(nodeSummary(node));
        });
        return results;
      }

      function clearMcpHighlights(cy) {
        cy.nodes(".onx-mcp-hl")
          .removeStyle("border-width border-color border-opacity background-color")
          .removeClass("onx-mcp-hl");
      }

      function applyNodeHighlights(cy, ids, color) {
        const highlighted = [];
        const missing = [];
        clearMcpHighlights(cy);
        ids.forEach(nid => {
          const n = cy.getElementById(nid);
          if (n.length) {
            n.addClass("onx-mcp-hl");
            n.select();
            n.style({
              "border-width": 5,
              "border-color": color,
              "border-opacity": 0.95,
              "background-color": color,
            });
            highlighted.push(nodeSummary(n));
          } else {
            missing.push(nid);
          }
        });
        return { highlighted, missing };
      }

      function fitIfAny(cy, ids) {
        let eles = cy.collection();
        ids.forEach(id => {
          const ele = cy.getElementById(id);
          if (ele.length) eles = eles.union(ele);
        });
        if (eles.length) {
          cy.animate({
            fit: { eles, padding: 120 },
            duration: 500,
            easing: "ease-in-out-cubic",
          });
        }
      }

      function handleCommand(msg) {
        const cy = getCy();
        const msgId = msg._id;
        pulseIndicator();

        try {
          switch (msg.cmd) {

          case "focus_node": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const node = cy.getElementById(msg.id);
            if (node.length === 0) return ack(msgId, false, { reason: `node '${msg.id}' not found` });

            cy.elements().unselect();
            node.select();

            cy.animate({
              fit: { eles: node, padding: 120 },
              duration: 600,
              easing: "ease-in-out-cubic",
            });

            // Flash highlight ring for 2.5s
            node.style({ "border-width": 6, "border-color": "#f59e0b", "border-opacity": 1 });
            setTimeout(() => node.removeStyle("border-width border-color border-opacity"), 2500);

            ack(msgId, true, { node: nodeSummary(node) });
            break;
          }

          case "highlight_nodes": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const color = msg.color ?? "#f59e0b";
            const ids = Array.isArray(msg.ids) ? msg.ids : [];

            cy.elements().unselect();
            const result = applyNodeHighlights(cy, ids, color);

            ack(msgId, true, {
              requested: ids.length,
              highlighted_count: result.highlighted.length,
              missing: result.missing,
              nodes: result.highlighted,
            });
            break;
          }

          case "filter_subgraph": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const ids = new Set(Array.isArray(msg.ids) ? msg.ids : []);

            cy.batch(() => {
              cy.nodes().forEach(n => {
                if (ids.has(n.id())) n.removeClass("onx-mcp-hide");
                else n.addClass("onx-mcp-hide");
              });
              cy.edges().forEach(e => {
                const hide = e.source().hasClass("onx-mcp-hide") || e.target().hasClass("onx-mcp-hide");
                if (hide) e.addClass("onx-mcp-hide");
                else e.removeClass("onx-mcp-hide");
              });
            });

            cy.style().selector(".onx-mcp-hide").style({ display: "none" }).update();
            ack(msgId, true, { requested: ids.size, visible_nodes: cy.nodes(":visible").length });
            break;
          }

          case "reset_view": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });

            cy.batch(() => {
              cy.elements()
                .removeClass("onx-mcp-hide onx-mcp-hl")
                .removeStyle("border-width border-color border-opacity background-color display");
            });

            // Rebuild stylesheet to clear any inline overrides
            if (typeof window.buildStyle === "function") {
              try { cy.style(window.buildStyle()); } catch { /* ignore */ }
            }

            cy.fit(cy.elements(":visible"), 60);
            ack(msgId, true);
            break;
          }

          case "set_layout": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            if (typeof window.applyLayout !== "function") return ack(msgId, false, { reason: "applyLayout not available" });
            try {
              window.applyLayout(msg.layout);
              ack(msgId, true);
            } catch (err) {
              ack(msgId, false, { reason: String(err?.message ?? err) });
            }
            break;
          }

          case "get_live_graph_summary": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const byCategory = {};
            const byNodeType = {};
            cy.nodes().forEach(node => {
              const data = node.data();
              const category = data.category || "?";
              const nodeType = data.nodeType || "?";
              byCategory[category] = (byCategory[category] || 0) + 1;
              byNodeType[nodeType] = (byNodeType[nodeType] || 0) + 1;
            });
            const topHubs = cy
              .nodes()
              .map(nodeSummary)
              .sort((a, b) => b.degree - a.degree)
              .slice(0, 10);
            ack(msgId, true, {
              node_count: cy.nodes().length,
              edge_count: cy.edges().length,
              visible_node_count: cy.nodes(":visible").length,
              selected_node_count: cy.nodes(":selected").length,
              by_category: byCategory,
              by_nodeType: byNodeType,
              top_hubs: topHubs,
            });
            break;
          }

          case "search_live_nodes": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const nodes = searchNodes(cy, msg.query, msg.limit);
            ack(msgId, true, { query: String(msg.query ?? ""), count: nodes.length, nodes });
            break;
          }

          case "get_live_node": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const node = cy.getElementById(msg.id);
            if (node.length === 0) return ack(msgId, false, { reason: `node '${msg.id}' not found` });
            ack(msgId, true, {
              node: { ...nodeSummary(node), data: node.data() },
              outgoing_edges: node.outgoers("edge").map(edgeSummary),
              incoming_edges: node.incomers("edge").map(edgeSummary),
            });
            break;
          }

          case "get_live_neighbors": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const start = cy.getElementById(msg.id);
            if (start.length === 0) return ack(msgId, false, { reason: `node '${msg.id}' not found` });
            const depth = Math.min(Math.max(Number(msg.depth) || 1, 1), 3);
            const direction = ["outgoing", "incoming", "both"].includes(String(msg.direction).toLowerCase())
              ? String(msg.direction).toLowerCase()
              : "both";
            const visited = new Set([start.id()]);
            let frontier = [start];
            const seenEdges = [];
            for (let i = 0; i < depth; i += 1) {
              const next = [];
              frontier.forEach(node => {
                const edgeSelector =
                  direction === "outgoing" ? node.outgoers("edge")
                    : direction === "incoming" ? node.incomers("edge")
                      : node.connectedEdges();
                edgeSelector.forEach(edge => {
                  const candidates = [];
                  if (direction === "outgoing" || direction === "both") candidates.push(edge.target());
                  if (direction === "incoming" || direction === "both") candidates.push(edge.source());
                  candidates.forEach(candidate => {
                    if (candidate.id() !== node.id() && !visited.has(candidate.id())) {
                      visited.add(candidate.id());
                      next.push(candidate);
                      seenEdges.push(edgeSummary(edge));
                    }
                  });
                });
              });
              frontier = next;
              if (!frontier.length) break;
            }
            const neighbors = Array.from(visited)
              .filter(id => id !== start.id())
              .map(id => nodeSummary(cy.getElementById(id)));
            ack(msgId, true, {
              origin: nodeSummary(start),
              depth,
              direction,
              neighbor_count: neighbors.length,
              neighbors,
              edges: seenEdges,
            });
            break;
          }

          case "get_live_grounded_path": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const source = cy.getElementById(String(msg.source_id || ""));
            const target = cy.getElementById(String(msg.target_id || ""));
            if (!source.length) return ack(msgId, false, { reason: `source '${msg.source_id}' not found` });
            if (!target.length) return ack(msgId, false, { reason: `target '${msg.target_id}' not found` });
            const allowed = Array.isArray(msg.allowed_truth_classes) ? new Set(msg.allowed_truth_classes.map(value => String(value).toLowerCase())) : null;
            const includeRejected = msg.include_rejected === true;
            const excluded = { truth_class: 0, rejected: 0, deleted: 0 };
            const usableEdges = cy.edges().filter(edge => {
              const rel = groundedEdgeSummary(edge);
              if (rel.lifecycle?.deleted === true) { excluded.deleted += 1; return false; }
              if (!includeRejected && rel.review?.status === "rejected") { excluded.rejected += 1; return false; }
              if (allowed && !allowed.has(String(rel.truthClass).toLowerCase())) { excluded.truth_class += 1; return false; }
              return true;
            });
            const visited = new Set([source.id()]);
            const queue = [source.id()];
            const parent = new Map();
            while (queue.length && !visited.has(target.id())) {
              const current = queue.shift();
              usableEdges.filter(edge => edge.source().id() === current || edge.target().id() === current).forEach(edge => {
                const neighbor = edge.source().id() === current ? edge.target().id() : edge.source().id();
                if (visited.has(neighbor)) return;
                visited.add(neighbor); parent.set(neighbor, { previous: current, edge }); queue.push(neighbor);
              });
            }
            if (!visited.has(target.id())) { ack(msgId, true, { found: false, source: source.id(), target: target.id(), excluded_edges: excluded }); break; }
            const nodeIds = [target.id()];
            const edges = [];
            let current = target.id();
            while (current !== source.id()) {
              const step = parent.get(current);
              edges.push(groundedEdgeSummary(step.edge)); nodeIds.push(step.previous); current = step.previous;
            }
            nodeIds.reverse(); edges.reverse();
            const evidenceIds = [...new Set(edges.flatMap(edge => edge.provenance?.evidenceIds || []).map(String))].sort();
            ack(msgId, true, {
              found: true, length: edges.length, source: source.id(), target: target.id(),
              nodes: nodeIds.map(id => ({ ...nodeSummary(cy.getElementById(id)), data: cy.getElementById(id).data() })),
              edges, evidence_ids: evidenceIds,
              grounding: { inspectable: true, excluded_edges: excluded, allowed_truth_classes: allowed ? [...allowed].sort() : "all", include_rejected: includeRejected },
            });
            break;
          }

          case "highlight_live_nodes_by_label": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const color = msg.color ?? "#f59e0b";
            const limit = Math.min(Math.max(Number(msg.limit) || 10, 1), 50);
            const matches = searchNodes(cy, msg.query, limit);
            cy.elements().unselect();
            const result = applyNodeHighlights(cy, matches.map(n => n.id), color);
            if (msg.focus_first !== false && result.highlighted.length) fitIfAny(cy, [result.highlighted[0].id]);
            ack(msgId, true, {
              query: String(msg.query ?? ""),
              matched_count: matches.length,
              highlighted_count: result.highlighted.length,
              nodes: result.highlighted,
            });
            break;
          }

          case "load_focused_graph": {
            const nodes = Array.isArray(msg.nodes) ? msg.nodes : [];
            const edges = Array.isArray(msg.edges) ? msg.edges : [];
            try {
              if (typeof window.onexusLoadGraph === "function") {
                window.onexusLoadGraph({ elements: { nodes, edges } });
              } else {
                cy.elements().remove();
                cy.add([...nodes, ...edges]);
              }
              setTimeout(() => {
                const layout = msg.layout ?? "cose";
                if (typeof window.applyLayout === "function") {
                  try { window.applyLayout(layout); } catch { /* ignore */ }
                } else {
                  try { cy.layout({ name: layout }).run(); } catch { /* ignore */ }
                }
                cy.fit(cy.elements(), 80);
              }, 150);
              ack(msgId, true, { node_count: nodes.length, edge_count: edges.length });
            } catch (err) {
              ack(msgId, false, { reason: String(err?.message ?? err) });
            }
            break;
          }

          case "select_random_live_nodes": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const color = msg.color ?? "#22c55e";
            const count = Math.min(Math.max(Number(msg.count) || 5, 1), 50);
            const nodes = cy.nodes(":visible").map(node => node.id());
            for (let i = nodes.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
            }
            const ids = nodes.slice(0, count);
            cy.elements().unselect();
            const result = applyNodeHighlights(cy, ids, color);
            fitIfAny(cy, ids);
            ack(msgId, true, {
              requested: count,
              selected_count: result.highlighted.length,
              nodes: result.highlighted,
            });
            break;
          }

          default:
            ack(msgId, false, { reason: `unknown command '${msg.cmd}'` });
          }
        } catch (err) {
          ack(msgId, false, { reason: String(err?.message ?? err) });
        }
      }

      // ── WebSocket lifecycle ───────────────────────────────────────────────
      function connect() {
        clearTimeout(reconnectTimer);
        try {
          ws = new WebSocket(WS_URL);
        } catch (err) {
          console.warn("[MCP-Bridge] WebSocket constructor failed:", err);
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
          return;
        }

        ws.addEventListener("open", () => {
          console.info("[MCP-Bridge] Connected to", WS_URL);
          setIndicator("connected");
          window.showTransientMessage?.("MCP Bridge connected — Claude can now control ONEXUS.");
        });

        ws.addEventListener("message", (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          handleCommand(msg);
        });

        ws.addEventListener("close", () => {
          setIndicator("disconnected");
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        });

        ws.addEventListener("error", () => {
          setIndicator("error");
          // 'close' fires immediately after 'error', which schedules the reconnect
        });
      }

      // ── Init ──────────────────────────────────────────────────────────────
      indicator = createIndicator();
      connect();

      console.info("[MCP-Bridge] Plugin registered. Connecting to", WS_URL);
    },
  });
})();
