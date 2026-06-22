# ONEXUS MCP Server

Gives Claude Code two superpowers over the ONEXUS graph tool:

| Layer | What it does |
|---|---|
| **Snapshot query tools** | Read and reason over vault-graph.json without the browser open |
| **Live browser tools** | Query and control the graph currently loaded in ONEXUS |

---

## Architecture

```
Claude Code  ──stdio──►  server.py (FastMCP)
                              │
                         WebSocket :8765
                              │
                    ONEXUS browser tab
                 (onexus-mcp-bridge.plugin.js)
                              │
                         Cytoscape.js
```

Snapshot query tools run even when the browser is closed.
Live browser tools require the ONEXUS tab to be open and the green bridge dot to be connected.

---

## Setup

### 1. Install Python dependencies

```bash
cd E:/GitHub/onexus/onexus-mcp
pip install -r requirements.txt
```

### 2. Register with Claude Code

Add to your MCP config. The config file lives at:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "onexus": {
      "command": "python",
      "args": ["E:/GitHub/onexus/onexus-mcp/server.py"]
    }
  }
}
```

Restart Claude Code / Claude Desktop after saving.

### 3. Open ONEXUS in your browser

The MCP bridge plugin (`onexus-mcp-bridge.plugin.js`) is already in `manifest.json`.  
When ONEXUS loads, it automatically connects to `ws://localhost:8765`.

**Status indicator:** a small dot appears in the bottom-right corner of ONEXUS:
- 🟢 Green — connected, control tools work
- ⚫ Grey — not connected (query tools still work)
- 🔴 Red — connection error (retrying every 4s)

---

## Available Tools

### Snapshot query tools (no browser needed)

| Tool | Description |
|---|---|
| `get_graph_summary` | Node/edge counts, category breakdown, top hubs |
| `search_nodes(query, limit)` | Full-text search across labels, categories, tags |
| `get_node(node_id)` | Full data + incoming/outgoing edges for one node |
| `get_neighbors(node_id, depth, direction)` | All nodes within N hops |
| `find_path(source_id, target_id)` | Shortest path between two nodes |
| `what_if(node_id, edge_types, direction, max_depth)` | Downstream impact analysis — what's reachable from a node, optionally restricted to specific edge types (e.g. `["blocks"]`). Returns structured data only; the calling agent narrates the result |
| `get_by_category(category, limit)` | All nodes in a category |
| `get_edge_types` | All edge types and their counts |

### Live browser query tools (browser must be open)

These tools inspect `window.cy`, so they work against whatever JSON/import is currently visible in ONEXUS.

| Tool | Description |
|---|---|
| `get_live_graph_summary` | Node/edge counts, category breakdown, top hubs from the live graph |
| `search_live_nodes(query, limit)` | Search live node ids, labels, categories, statuses, and tags |
| `get_live_node(node_id)` | Full live node data + incoming/outgoing edge summaries |
| `get_live_neighbors(node_id, depth, direction)` | Live neighbors within 1-3 hops |

### Live browser control tools (browser must be open)

| Tool | Description |
|---|---|
| `focus_node(node_id)` | Pan + zoom to a node, flash highlight ring |
| `highlight_nodes(node_ids, color)` | Highlight exact Cytoscape node ids; returns actual highlighted/missing ids |
| `highlight_live_nodes_by_label(query, limit, color, focus_first)` | Search the live graph by label/id/category and highlight matches |
| `select_random_live_nodes(count, color)` | Select and highlight random visible nodes for connection tests |
| `filter_to_subgraph(node_ids)` | Hide everything except the given nodes |
| `reset_view` | Clear all highlights/filters, fit full graph |
| `set_layout(layout)` | Apply any ONEXUS layout |

Valid layouts: `cose`, `tree_nested`, `degree_rings`, `category_lanes`,  
`dependency_flow`, `assembly_chains`, `compact_grid`, `system`, `spatial`, `responsibility`

---

## Example Claude prompts

```
Which ONEXUS nodes are most connected to the MCP-Protocol concept?
→ search_nodes("MCP-Protocol") → get_neighbors(id, depth=2) → highlight_nodes(ids)

What is currently open in ONEXUS?
→ get_live_graph_summary()

Highlight the Face Recognition Unit in the sample graph.
→ highlight_live_nodes_by_label("Face Recognition Unit")

Pick random visible nodes to test the live bridge.
→ select_random_live_nodes(5)

Show me the path between the VIKTOR project and BHoM.
→ find_path("projects/VIKTOR.md", "concepts/BHoM.md") → focus_node on each hop

Steel Fabricator A is delayed 3 weeks — what's at risk?
→ what_if("SUP-STEEL-A") → narrate the affected chain using the returned
  depth/via_edge_type/via_direction fields (loaded sample:
  samples/json/onexus_ic_supply_chain_sample.json)

Filter the graph to only show Project and Concept nodes.
→ get_by_category("Project") + get_by_category("Concept") → filter_to_subgraph(ids)
```

---

## vault-graph.json location

The server looks for `vault-graph.json` at:
```
E:/GitHub/esen-vault/vault-graph.json
```

If it doesn't exist there, it falls back to `onexus-mcp/vault-graph.json`.  
Re-generate it any time by running the vault graph exporter in the esen-vault repo.
