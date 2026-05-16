"""
ONEXUS MCP Server
=================
Two-layer architecture:
  1. FastMCP (stdio) — Claude Code registers this as an MCP tool server.
  2. WebSocket server on ws://localhost:8765 — the browser ONEXUS plugin
     connects here so Claude can control the live graph (focus, highlight, filter, layout).

Query tools work even without the browser connected (they read vault-graph.json directly).
Control tools require the browser plugin to be connected; they time-out gracefully if not.

Usage
-----
  cd E:/GitHub/onexus/onexus-mcp
  pip install -r requirements.txt
  python server.py

Claude Desktop / Code config (~/.claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "onexus": {
        "command": "python",
        "args": ["E:/GitHub/onexus/onexus-mcp/server.py"]
      }
    }
  }
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

import websockets
from fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
WS_PORT = 8765
CONTROL_TIMEOUT = 8  # seconds to wait for browser ACK

# Search order for vault-graph.json
_GRAPH_SEARCH_PATHS = [
    Path(r"E:\GitHub\esen-vault\vault-graph.json"),            # explicit Windows path
    Path(__file__).parent.parent.parent / "esen-vault" / "vault-graph.json",  # relative
    Path(__file__).parent / "vault-graph.json",                # next to server.py
]

# ---------------------------------------------------------------------------
# Graph data (loaded once at startup, reloadable)
# ---------------------------------------------------------------------------
_graph: dict[str, Any] = {"nodes": [], "edges": []}
_nodes_by_id: dict[str, dict] = {}
_edges_by_id: dict[str, dict] = {}
_graph_path_used: str = "(none)"

def _load_graph() -> str:
    """Load vault-graph.json from the first path that exists. Returns status string."""
    global _graph, _nodes_by_id, _edges_by_id, _graph_path_used

    resolved = None
    for candidate in _GRAPH_SEARCH_PATHS:
        try:
            if candidate.exists():
                resolved = candidate
                break
        except Exception:
            continue

    if resolved is None:
        _graph_path_used = "(not found)"
        searched = [str(p) for p in _GRAPH_SEARCH_PATHS]
        return f"vault-graph.json not found. Searched: {searched}"

    with open(resolved, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Support both flat {nodes, edges} and nested {elements: {nodes, edges}} (ONEXUS 1.1)
    if "elements" in raw and isinstance(raw["elements"], dict):
        _graph = raw["elements"]
    else:
        _graph = raw

    _nodes_by_id = {n["data"]["id"]: n["data"] for n in _graph.get("nodes", [])}
    _edges_by_id = {e["data"]["id"]: e["data"] for e in _graph.get("edges", [])}
    _graph_path_used = str(resolved)

    n_nodes = len(_graph.get("nodes", []))
    n_edges = len(_graph.get("edges", []))
    return f"Loaded {n_nodes} nodes, {n_edges} edges from {resolved}"

_load_graph()

# ---------------------------------------------------------------------------
# WebSocket bridge (runs in a background thread with its own event loop)
# ---------------------------------------------------------------------------
_ws_clients: set[websockets.ServerConnection] = set()
_ws_loop: asyncio.AbstractEventLoop | None = None
_pending_acks: dict[str, asyncio.Future] = {}

async def _ws_handler(ws: websockets.ServerConnection) -> None:
    _ws_clients.add(ws)
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            # Handle ACK messages from browser
            ack_id = msg.get("ack")
            if ack_id and ack_id in _pending_acks:
                fut = _pending_acks[ack_id]
                if not fut.done():
                    fut.set_result(msg)
    except websockets.ConnectionClosed:
        pass
    finally:
        _ws_clients.discard(ws)

async def _ws_serve() -> None:
    async with websockets.serve(_ws_handler, "localhost", WS_PORT):
        await asyncio.Future()  # run forever

def _start_ws_thread() -> None:
    global _ws_loop
    _ws_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_ws_loop)
    _ws_loop.run_until_complete(_ws_serve())

_ws_thread = threading.Thread(target=_start_ws_thread, daemon=True, name="ws-bridge")
_ws_thread.start()

# ---------------------------------------------------------------------------
# Helper: send command to browser and optionally wait for ACK
# ---------------------------------------------------------------------------
_cmd_counter = 0

async def _send_command(cmd: dict, wait_ack: bool = True) -> dict:
    global _cmd_counter
    if not _ws_clients:
        return {"ok": False, "reason": "no_browser_connected"}

    _cmd_counter += 1
    cmd_id = f"cmd-{_cmd_counter}"
    cmd["_id"] = cmd_id

    payload = json.dumps(cmd)

    if _ws_loop is None:
        return {"ok": False, "reason": "ws_not_ready"}

    async def _do_send() -> dict:
        fut: asyncio.Future = _ws_loop.create_future()
        _pending_acks[cmd_id] = fut
        dead_clients = set()
        for ws in list(_ws_clients):
            try:
                await ws.send(payload)
            except Exception:
                dead_clients.add(ws)
        _ws_clients -= dead_clients

        if not wait_ack:
            _pending_acks.pop(cmd_id, None)
            return {"ok": True}

        try:
            result = await asyncio.wait_for(fut, timeout=CONTROL_TIMEOUT)
            return result
        except asyncio.TimeoutError:
            return {"ok": False, "reason": "timeout_no_browser_ack"}
        finally:
            _pending_acks.pop(cmd_id, None)

    # Schedule the coroutine on the WS event loop and block the MCP thread
    future = asyncio.run_coroutine_threadsafe(_do_send(), _ws_loop)
    try:
        return future.result(timeout=CONTROL_TIMEOUT + 2)
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}

def _send_ctrl(cmd: dict, wait_ack: bool = False) -> str:
    """Blocking wrapper used by synchronous MCP tool functions."""
    if not _ws_clients:
        return json.dumps({"ok": False, "reason": "ONEXUS browser tab not connected. Open ONEXUS and wait for the plugin to connect."})
    result = asyncio.run_coroutine_threadsafe(
        _send_command(cmd, wait_ack), _ws_loop
    ).result(timeout=CONTROL_TIMEOUT + 2)
    return json.dumps(result, ensure_ascii=False)

# ---------------------------------------------------------------------------
# FastMCP server
# ---------------------------------------------------------------------------
mcp = FastMCP("onexus")

# ── Query tools ─────────────────────────────────────────────────────────────

@mcp.tool()
def get_server_info() -> str:
    """Return diagnostic info about the MCP server: graph file path, node/edge counts,
    WebSocket status, and connected browser count."""
    return json.dumps({
        "graph_file": _graph_path_used,
        "node_count": len(_graph.get("nodes", [])),
        "edge_count": len(_graph.get("edges", [])),
        "ws_port": WS_PORT,
        "browser_clients_connected": len(_ws_clients),
        "search_paths_tried": [str(p) for p in _GRAPH_SEARCH_PATHS],
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def reload_graph() -> str:
    """Reload vault-graph.json from disk without restarting the server.
    Use this after regenerating the graph file."""
    status = _load_graph()
    return json.dumps({
        "status": status,
        "node_count": len(_graph.get("nodes", [])),
        "edge_count": len(_graph.get("edges", [])),
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def get_graph_summary() -> str:
    """Return high-level statistics about the loaded ONEXUS / vault graph:
    total node count, total edge count, breakdown by category and nodeType,
    and top-10 hub nodes by degree."""
    nodes = _graph.get("nodes", [])
    edges = _graph.get("edges", [])

    cats: dict[str, int] = {}
    types: dict[str, int] = {}
    for n in nodes:
        d = n.get("data", {})
        cats[d.get("category", "?")] = cats.get(d.get("category", "?"), 0) + 1
        types[d.get("nodeType", "?")] = types.get(d.get("nodeType", "?"), 0) + 1

    # degree map
    deg: dict[str, int] = {}
    for e in edges:
        d = e.get("data", {})
        s, t = d.get("source", ""), d.get("target", "")
        deg[s] = deg.get(s, 0) + 1
        deg[t] = deg.get(t, 0) + 1

    top10 = sorted(deg.items(), key=lambda x: x[1], reverse=True)[:10]
    top10_labeled = [
        {"id": nid, "label": _nodes_by_id.get(nid, {}).get("displayLabel", nid), "degree": d}
        for nid, d in top10
    ]

    return json.dumps({
        "node_count": len(nodes),
        "edge_count": len(edges),
        "by_category": cats,
        "by_nodeType": types,
        "top_hubs": top10_labeled,
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def search_nodes(query: str, limit: int = 20) -> str:
    """Search nodes by label, id, category, status, or tags.
    Returns a list of matching nodes with their key data fields.

    Args:
        query: Case-insensitive substring to match against id, displayLabel, category, status, tags.
        limit: Max results to return (default 20, max 100).
    """
    limit = min(max(1, limit), 100)
    q = query.lower()
    results = []
    for n in _graph.get("nodes", []):
        d = n.get("data", {})
        haystack = " ".join(filter(None, [
            d.get("id", ""),
            d.get("displayLabel", ""),
            d.get("category", ""),
            d.get("status", ""),
            " ".join(d.get("tags", []) if isinstance(d.get("tags"), list) else []),
        ])).lower()
        if q in haystack:
            results.append({
                "id": d.get("id"),
                "label": d.get("displayLabel", d.get("id")),
                "category": d.get("category"),
                "nodeType": d.get("nodeType"),
                "status": d.get("status"),
                "tags": d.get("tags", []),
            })
            if len(results) >= limit:
                break
    return json.dumps({"count": len(results), "nodes": results}, ensure_ascii=False, indent=2)


@mcp.tool()
def get_node(node_id: str) -> str:
    """Return full data for a single node by its id.

    Args:
        node_id: The node's id (e.g. 'projects/ONEXUS.md').
    """
    d = _nodes_by_id.get(node_id)
    if d is None:
        return json.dumps({"error": f"Node '{node_id}' not found."})

    # Collect edges
    outgoing, incoming = [], []
    for e in _graph.get("edges", []):
        ed = e.get("data", {})
        if ed.get("source") == node_id:
            outgoing.append({"target": ed.get("target"), "type": ed.get("type")})
        if ed.get("target") == node_id:
            incoming.append({"source": ed.get("source"), "type": ed.get("type")})

    return json.dumps({
        "node": d,
        "outgoing_edges": outgoing[:50],
        "incoming_edges": incoming[:50],
        "degree": len(outgoing) + len(incoming),
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def get_neighbors(node_id: str, depth: int = 1, direction: str = "both") -> str:
    """Return all nodes reachable within N hops from a given node.

    Args:
        node_id: Starting node id.
        depth: How many hops out to traverse (1–3, default 1).
        direction: 'outgoing', 'incoming', or 'both'.
    """
    depth = min(max(1, depth), 3)
    direction = direction.lower()
    if direction not in ("outgoing", "incoming", "both"):
        direction = "both"

    visited: set[str] = {node_id}
    frontier: set[str] = {node_id}
    edges_seen: list[dict] = []

    for _ in range(depth):
        next_frontier: set[str] = set()
        for e in _graph.get("edges", []):
            ed = e.get("data", {})
            s, t = ed.get("source", ""), ed.get("target", "")
            if direction in ("outgoing", "both") and s in frontier and t not in visited:
                next_frontier.add(t)
                edges_seen.append({"source": s, "target": t, "type": ed.get("type")})
            if direction in ("incoming", "both") and t in frontier and s not in visited:
                next_frontier.add(s)
                edges_seen.append({"source": s, "target": t, "type": ed.get("type")})
        visited |= next_frontier
        frontier = next_frontier
        if not frontier:
            break

    neighbor_nodes = [
        {
            "id": nid,
            "label": _nodes_by_id.get(nid, {}).get("displayLabel", nid),
            "category": _nodes_by_id.get(nid, {}).get("category"),
        }
        for nid in visited if nid != node_id
    ]

    return json.dumps({
        "origin": node_id,
        "depth": depth,
        "neighbor_count": len(neighbor_nodes),
        "neighbors": neighbor_nodes,
        "edges": edges_seen,
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def find_path(source_id: str, target_id: str) -> str:
    """Find the shortest path between two nodes using BFS over all edges.

    Args:
        source_id: Starting node id.
        target_id: Destination node id.
    """
    if source_id not in _nodes_by_id:
        return json.dumps({"error": f"Source '{source_id}' not found."})
    if target_id not in _nodes_by_id:
        return json.dumps({"error": f"Target '{target_id}' not found."})

    # Build adjacency list (undirected for path finding)
    adj: dict[str, list[tuple[str, str]]] = {}
    for e in _graph.get("edges", []):
        ed = e.get("data", {})
        s, t, etype = ed.get("source", ""), ed.get("target", ""), ed.get("type", "")
        adj.setdefault(s, []).append((t, etype))
        adj.setdefault(t, []).append((s, etype))

    # BFS
    from collections import deque
    queue: deque[tuple[str, list[str], list[str]]] = deque([(source_id, [source_id], [])])
    visited: set[str] = {source_id}
    MAX_NODES = 5000

    while queue:
        cur, path, etypes = queue.popleft()
        for neighbor, etype in adj.get(cur, []):
            if neighbor == target_id:
                full_path = path + [neighbor]
                return json.dumps({
                    "found": True,
                    "length": len(full_path) - 1,
                    "path": full_path,
                    "edge_types": etypes + [etype],
                    "labeled_path": [
                        _nodes_by_id.get(nid, {}).get("displayLabel", nid)
                        for nid in full_path
                    ],
                }, ensure_ascii=False, indent=2)
            if neighbor not in visited:
                visited.add(neighbor)
                if len(visited) < MAX_NODES:
                    queue.append((neighbor, path + [neighbor], etypes + [etype]))

    return json.dumps({"found": False, "message": f"No path found between '{source_id}' and '{target_id}'."})


@mcp.tool()
def get_by_category(category: str, limit: int = 50) -> str:
    """List all nodes belonging to a given category.

    Valid categories: Project, Project-Detail, Concept, Concept-Sub, Industry,
    Work, Daily, Navigation, Personal, Research, Ideas, Framework, Tag.

    Args:
        category: The category name (case-insensitive prefix match).
        limit: Max results (default 50, max 200).
    """
    limit = min(max(1, limit), 200)
    cat_q = category.lower()
    results = []
    for n in _graph.get("nodes", []):
        d = n.get("data", {})
        if (d.get("category", "") or "").lower().startswith(cat_q):
            results.append({
                "id": d.get("id"),
                "label": d.get("displayLabel", d.get("id")),
                "status": d.get("status"),
                "tags": d.get("tags", []),
            })
            if len(results) >= limit:
                break
    return json.dumps({"category": category, "count": len(results), "nodes": results}, ensure_ascii=False, indent=2)


@mcp.tool()
def get_edge_types() -> str:
    """Return all distinct edge types in the graph and their counts."""
    counts: dict[str, int] = {}
    for e in _graph.get("edges", []):
        etype = e.get("data", {}).get("type", "unknown")
        counts[etype] = counts.get(etype, 0) + 1
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return json.dumps({"edge_types": [{"type": t, "count": c} for t, c in ranked]}, ensure_ascii=False, indent=2)


# ── Control tools ────────────────────────────────────────────────────────────

@mcp.tool()
def focus_node(node_id: str) -> str:
    """Pan and zoom the ONEXUS graph to center on a specific node and select it.
    Requires the ONEXUS browser tab to be open with the MCP bridge plugin active.

    Args:
        node_id: The id of the node to focus (e.g. 'projects/ONEXUS.md').
    """
    return _send_ctrl({"cmd": "focus_node", "id": node_id})


@mcp.tool()
def highlight_nodes(node_ids: list[str], color: str = "#f59e0b") -> str:
    """Temporarily highlight a set of nodes with a colored overlay in ONEXUS.
    Use reset_view() to clear the highlight.

    Args:
        node_ids: List of node ids to highlight.
        color: CSS color string for the highlight (default amber #f59e0b).
    """
    return _send_ctrl({"cmd": "highlight_nodes", "ids": node_ids, "color": color})


@mcp.tool()
def filter_to_subgraph(node_ids: list[str]) -> str:
    """Hide all nodes/edges NOT in the given set, leaving only the specified subgraph visible.
    Use reset_view() to restore the full graph.

    Args:
        node_ids: List of node ids to keep visible.
    """
    return _send_ctrl({"cmd": "filter_subgraph", "ids": node_ids})


@mcp.tool()
def reset_view() -> str:
    """Clear all highlights and filters applied by focus_node, highlight_nodes,
    or filter_to_subgraph, and fit the full graph in view."""
    return _send_ctrl({"cmd": "reset_view"})


@mcp.tool()
def set_layout(layout: str) -> str:
    """Apply a graph layout in ONEXUS.

    Valid layouts: cose, tree_nested, degree_rings, category_lanes,
    dependency_flow, assembly_chains, compact_grid, system, spatial, responsibility.

    Args:
        layout: Layout name string.
    """
    valid = {
        "cose", "tree_nested", "degree_rings", "category_lanes",
        "dependency_flow", "assembly_chains", "compact_grid",
        "system", "spatial", "responsibility",
    }
    if layout not in valid:
        return json.dumps({"error": f"Unknown layout '{layout}'. Valid: {sorted(valid)}"})
    return _send_ctrl({"cmd": "set_layout", "layout": layout})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run()
