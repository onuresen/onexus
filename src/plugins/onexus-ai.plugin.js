/* ONEXUS AI Plugin
   Browser-side "what if" impact narration — no Python/MCP server required.
   Mirrors Thinking Hub's hub-ai.js key-management pattern (own Anthropic API
   key stored in localStorage, official SDK loaded from esm.sh), but the
   graph traversal itself is pure client-side logic against window.cy —
   it ports the onexus-mcp what_if() tool's BFS so it works with no
   server running at all, just the page open in a browser.

   window.ONEXUS_AI exposes:
     getKey() / saveKey(key) / isConfigured()
     whatIf(nodeId, opts)              — pure traversal, no API call
     askWhatIf(nodeId, question, opts) — traversal + Claude narration
*/
(function () {
  const ONEXUS = window.ONEXUS;
  if (!ONEXUS || typeof ONEXUS.registerPlugin !== "function") {
    console.warn("[ONEXUS-AI] ONEXUS not available — plugin loaded too early?");
    return;
  }

  const SETTINGS_KEY = "onexus.ai.v1";
  const MODEL = "claude-haiku-4-5";
  const SDK_URL = "https://esm.sh/@anthropic-ai/sdk@0.52.0"; // pinned — update manually after testing

  let _sdkPromise = null;
  let _clientCache = null;

  // ── Key management ──────────────────────────────────────────────────────
  function getKey() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return (s.anthropicKey || "").trim();
    } catch { return ""; }
  }

  function saveKey(key) {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      s.anthropicKey = String(key ?? "").trim();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      _clientCache = null;
    } catch { /* localStorage unavailable — key just won't persist */ }
  }

  function isConfigured() { return getKey().length > 10; }

  // ── SDK ──────────────────────────────────────────────────────────────────
  async function _loadSDK() {
    if (!_sdkPromise) {
      _sdkPromise = import(SDK_URL).then((m) => m.default || m.Anthropic || m);
    }
    return _sdkPromise;
  }

  async function _getClient() {
    const key = getKey();
    if (!key) throw new Error("No Anthropic API key configured. Call ONEXUS_AI.saveKey(key) or use the 🔮 button.");
    if (_clientCache && _clientCache._key === key) return _clientCache._client;
    const Anthropic = await _loadSDK();
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    _clientCache = { _key: key, _client: client };
    return client;
  }

  async function testKey(keyOverride) {
    const key = keyOverride || getKey();
    if (!key) return { ok: false, message: "No key provided" };
    try {
      const Anthropic = await _loadSDK();
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      await client.messages.create({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "Hi" }] });
      return { ok: true, message: `Connected · ${MODEL}` };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  }

  // ── Label/data helpers (same convention as onexus-mcp-bridge.plugin.js) ──
  function getLabel(data) {
    if (!data) return "";
    const label = data.displayLabel ?? data.label ?? data.name ?? data.title;
    if (typeof label === "string") return label;
    if (label && typeof label === "object") return label.en ?? label.jp ?? Object.values(label)[0] ?? "";
    return data.id ?? "";
  }

  // ── Pure traversal: ports onexus-mcp/server.py's what_if() to JS ─────────
  // Direction is NOT inferred from edge type — same reasoning as the Python
  // tool: a "supplies" edge means impact flows outgoing, but a "requires"
  // edge (process -> component) means impact flows incoming (if the
  // component is late, the process — the edge's source — is affected).
  // Default "both" so nothing is silently missed.
  function whatIf(nodeId, opts = {}) {
    const cy = window.cy;
    if (!cy) return { error: "No graph loaded." };
    const start = cy.getElementById(nodeId);
    if (!start || start.length === 0) return { error: `Node '${nodeId}' not found.` };

    const edgeTypes = Array.isArray(opts.edgeTypes) && opts.edgeTypes.length
      ? new Set(opts.edgeTypes) : null;
    const direction = ["outgoing", "incoming", "both"].includes(opts.direction)
      ? opts.direction : "both";
    const maxDepth = Math.min(Math.max(Number(opts.maxDepth) || 5, 1), 10);

    const visited = new Set([nodeId]);
    let frontier = [nodeId];
    const affected = [];

    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
      const next = [];
      frontier.forEach((id) => {
        const node = cy.getElementById(id);
        if (!node.length) return;
        const edges = direction === "outgoing" ? node.outgoers("edge")
          : direction === "incoming" ? node.incomers("edge")
            : node.connectedEdges();
        edges.forEach((edge) => {
          const ed = edge.data();
          if (edgeTypes && !edgeTypes.has(ed.type)) return;
          const isOutgoing = edge.source().id() === id;
          const nb = isOutgoing ? edge.target() : edge.source();
          if (!nb.length || visited.has(nb.id())) return;
          visited.add(nb.id());
          const nbData = nb.data();
          affected.push({
            id: nb.id(),
            label: getLabel(nbData),
            category: nbData.category,
            depth: depth + 1,
            via_edge_type: ed.type,
            via_direction: isOutgoing ? "outgoing" : "incoming",
            via_node: id,
          });
          next.push(nb.id());
        });
      });
      frontier = next;
    }

    return {
      origin: nodeId,
      origin_label: getLabel(start.data()),
      edge_types_followed: edgeTypes ? [...edgeTypes].sort() : "all",
      direction,
      max_depth: maxDepth,
      affected_count: affected.length,
      affected,
    };
  }

  // ── Traversal + Claude narration ──────────────────────────────────────────
  async function askWhatIf(nodeId, question, opts = {}) {
    const result = whatIf(nodeId, opts);
    if (result.error) throw new Error(result.error);

    const client = await _getClient();
    const system = `You are a graph-impact analyst for ONEXUS. You are given structured downstream-impact data — a BFS traversal of a relationship graph: affected nodes, their hop depth from the origin, and which edge type/direction connected each one. Narrate the cascade in plain, concrete language: name the actual nodes and the causal chain, don't just repeat the JSON. Be concise (a few sentences to a short paragraph). If "affected" is empty, say plainly that nothing is reachable with the given filters.`;
    const userMsg = `Origin: ${result.origin_label} (${result.origin})\nQuestion: ${question || "What happens downstream if this changes?"}\n\nImpact data:\n${JSON.stringify(result, null, 2)}`;

    const msg = await client.messages.create({
      model: MODEL, max_tokens: 600, system,
      messages: [{ role: "user", content: userMsg }],
    });
    return { narration: msg.content?.[0]?.text || "", impact: result };
  }

  window.ONEXUS_AI = { getKey, saveKey, isConfigured, testKey, whatIf, askWhatIf };

  // ── Minimal self-contained UI: a floating button + panel ─────────────────
  // Deliberately doesn't touch index.html/toolbar — same isolation pattern
  // as the MCP bridge's status dot, so this plugin can be added/removed
  // without any core file changes.
  ONEXUS.registerPlugin({
    id: "onexus-ai",
    name: "ONEXUS AI (What-If)",
    version: "1.0.0",

    register(_api) {
      const btn = document.createElement("button");
      btn.id = "onx-ai-btn";
      btn.title = "What if? (browser-side AI impact narration)";
      btn.textContent = "🔮";
      Object.assign(btn.style, {
        position: "fixed", bottom: "14px", right: "32px",
        width: "30px", height: "30px", borderRadius: "50%",
        border: "1px solid var(--stroke, #e5e7eb)",
        background: "var(--btn-bg, #fff)", cursor: "pointer",
        fontSize: "14px", zIndex: "9999", lineHeight: "1",
      });

      let panel = null;
      function closePanel() { panel?.remove(); panel = null; }

      function openPanel() {
        if (panel) { closePanel(); return; }
        panel = document.createElement("div");
        Object.assign(panel.style, {
          position: "fixed", bottom: "52px", right: "32px",
          width: "320px", maxHeight: "70vh", overflowY: "auto",
          background: "var(--bg-panel, #fff)", color: "var(--text-main, #111)",
          border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px",
          padding: "10px", zIndex: "9999", fontSize: "12px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        });

        const configured = isConfigured();
        panel.innerHTML = `
          <div style="font-weight:700;margin-bottom:6px;">What if? (no MCP needed)</div>
          ${configured ? "" : `<div style="margin-bottom:6px;color:#b45309;">No API key set.</div>
            <input id="onx-ai-key" type="password" placeholder="Anthropic API key" style="width:100%;margin-bottom:6px;padding:4px;box-sizing:border-box;">
            <button id="onx-ai-savekey" style="width:100%;margin-bottom:8px;">Save key</button>`}
          <input id="onx-ai-node" type="text" placeholder="Node id (selected node used if blank)" style="width:100%;margin-bottom:6px;padding:4px;box-sizing:border-box;">
          <input id="onx-ai-q" type="text" placeholder="Question (optional)" style="width:100%;margin-bottom:6px;padding:4px;box-sizing:border-box;">
          <button id="onx-ai-ask" style="width:100%;">Ask</button>
          <div id="onx-ai-out" style="margin-top:8px;white-space:pre-wrap;"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector("#onx-ai-savekey")?.addEventListener("click", () => {
          const v = panel.querySelector("#onx-ai-key").value;
          if (v) { saveKey(v); window.showTransientMessage?.("Anthropic key saved."); closePanel(); openPanel(); }
        });

        panel.querySelector("#onx-ai-ask").addEventListener("click", async () => {
          const out = panel.querySelector("#onx-ai-out");
          const nodeField = panel.querySelector("#onx-ai-node").value.trim();
          const question = panel.querySelector("#onx-ai-q").value.trim();
          const selected = window.cy?.nodes(":selected").first();
          const nodeId = nodeField || (selected && selected.length ? selected.id() : "");
          if (!nodeId) { out.textContent = "Select a node in the graph or type its id."; return; }
          out.textContent = "Thinking…";
          try {
            const { narration } = await askWhatIf(nodeId, question);
            out.textContent = narration;
          } catch (err) {
            out.textContent = `Error: ${err.message ?? err}`;
          }
        });
      }

      btn.addEventListener("click", openPanel);
      document.body.appendChild(btn);

      console.info("[ONEXUS-AI] Plugin registered. window.ONEXUS_AI available.");
    },
  });
})();
