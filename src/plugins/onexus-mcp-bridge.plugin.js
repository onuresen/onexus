/* ONEXUS MCP Bridge Plugin
   Connects to the local Python MCP WebSocket server (ws://localhost:8765).
   Dispatches graph control commands received from Claude to the live Cytoscape instance.

   Commands handled (sent as JSON from server.py):
     focus_node      { cmd, id }
     highlight_nodes { cmd, ids, color }
     filter_subgraph { cmd, ids }
     reset_view      { cmd }
     set_layout      { cmd, layout }

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
      }

      // ── Command dispatcher ────────────────────────────────────────────────
      function ack(msgId, ok, extra) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ack: msgId, ok, ...(extra ?? {}) }));
        }
      }

      function getCy() { return window.cy; }

      function handleCommand(msg) {
        const cy = getCy();
        const msgId = msg._id;

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

            ack(msgId, true);
            break;
          }

          case "highlight_nodes": {
            if (!cy) return ack(msgId, false, { reason: "cy not ready" });
            const color = msg.color ?? "#f59e0b";
            const ids = Array.isArray(msg.ids) ? msg.ids : [];

            // Clear previous MCP highlights
            cy.nodes(".onx-mcp-hl")
              .removeStyle("border-width border-color border-opacity background-color")
              .removeClass("onx-mcp-hl");

            ids.forEach(nid => {
              const n = cy.getElementById(nid);
              if (n.length) {
                n.addClass("onx-mcp-hl");
                n.style({ "border-width": 5, "border-color": color, "border-opacity": 0.95, "background-color": color });
              }
            });

            ack(msgId, true, { highlighted: ids.length });
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
            ack(msgId, true, { visible: ids.size });
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

          default:
            ack(msgId, false, { reason: `unknown command '${msg.cmd}'` });
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
