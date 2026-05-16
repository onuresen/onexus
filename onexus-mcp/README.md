# ONEXUS MCP Server

Gives Claude Code two superpowers over the ONEXUS graph tool:

| Layer | What it does |
|---|---|
| **Query tools** | Read and reason over vault-graph.json without the browser open |
| **Control tools** | Remotely pan/zoom/highlight/filter the live ONEXUS graph in your browser |

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

Query tools run even when the browser is closed.  
Control tools require the browser tab to be open — they return a helpful error if not connected.

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

### Query tools (no browser needed)

| Tool | Description |
|---|---|
| `get_graph_summary` | Node/edge counts, category breakdown, top hubs |
| `search_nodes(query, limit)` | Full-text search across labels, categories, tags |
| `get_node(node_id)` | Full data + incoming/outgoing edges for one node |
| `get_neighbors(node_id, depth, direction)` | All nodes within N hops |
| `find_path(source_id, target_id)` | Shortest path between two nodes |
| `get_by_category(category, limit)` | All nodes in a category |
| `get_edge_types` | All edge types and their counts |

### Control tools (browser must be open)

| Tool | Description |
|---|---|
| `focus_node(node_id)` | Pan + zoom to a node, flash highlight ring |
| `highlight_nodes(node_ids, color)` | Color overlay on a set of nodes |
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

Show me the path between the VIKTOR project and BHoM.
→ find_path("projects/VIKTOR.md", "concepts/BHoM.md") → focus_node on each hop

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
