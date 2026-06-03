"""
ONEXUS MCP Server
=================
FastMCP stdio server with an embedded WebSocket server (port 8765).
Both run in the SAME asyncio event loop via FastMCP's lifespan hook —
no threading, no cross-loop scheduling, no race conditions.

Claude Desktop / Code config:
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
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import websockets
from fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
WS_PORT = int(os.environ.get("ONEXUS_WS_PORT", "8765"))
CONTROL_TIMEOUT = int(os.environ.get("ONEXUS_CONTROL_TIMEOUT", "8"))
# Max inbound WebSocket frame (bytes) — guards against a buggy/malicious client
# sending an oversized message. Default 16 MiB; override with ONEXUS_WS_MAX_SIZE.
WS_MAX_SIZE = int(os.environ.get("ONEXUS_WS_MAX_SIZE", str(16 * 1024 * 1024)))


def _log(*args: Any) -> None:
    """Log to stderr — stdout is reserved for the MCP stdio transport."""
    print("[onexus-mcp]", *args, file=sys.stderr, flush=True)


# Resolve the vault graph path. ONEXUS_VAULT_GRAPH (env) takes precedence so the
# server is portable across machines/OSes; the rest are best-effort fallbacks.
_GRAPH_SEARCH_PATHS = [
    p for p in [
        Path(os.environ["ONEXUS_VAULT_GRAPH"]) if os.environ.get("ONEXUS_VAULT_GRAPH") else None,
        Path(__file__).parent.parent.parent / "esen-vault" / "vault-graph.json",
        Path(__file__).parent / "vault-graph.json",
    ] if p is not None
]

# ---------------------------------------------------------------------------
# Graph (loaded once at startup)
# ---------------------------------------------------------------------------
_graph: dict[str, Any] = {"nodes": [], "edges": []}
_nodes_by_id: dict[str, dict] = {}
_graph_path_used: str = "(none)"


def _load_graph() -> str:
    global _graph, _nodes_by_id, _graph_path_used
    for candidate in _GRAPH_SEARCH_PATHS:
        try:
            if candidate.exists():
                with open(candidate, encoding="utf-8") as f:
                    raw = json.load(f)
                # Support both flat {nodes,edges} and nested {elements:{nodes,edges}}
                _graph = raw.get("elements", raw)
                # Tolerate nodes missing data/id rather than crashing the whole load.
                _nodes_by_id = {
                    nid: data
                    for n in _graph.get("nodes", [])
                    if isinstance(data := n.get("data", {}), dict) and (nid := data.get("id"))
                }
                _graph_path_used = str(candidate)
                n = len(_graph.get("nodes", []))
                e = len(_graph.get("edges", []))
                return f"Loaded {n} nodes, {e} edges from {candidate}"
        except Exception as exc:
            _log(f"failed to load graph from {candidate}: {exc!r}")
            continue
    _graph_path_used = "(not found)"
    return f"vault-graph.json not found. Searched: {[str(p) for p in _GRAPH_SEARCH_PATHS]}"


_load_graph()

# ---------------------------------------------------------------------------
# WebSocket state (all accessed from FastMCP's single event loop)
# ---------------------------------------------------------------------------
_ws_clients: set = set()
_pending_browser_requests: dict[str, asyncio.Future] = {}


async def _ws_handler(ws) -> None:
    _ws_clients.add(ws)
    _log(f"browser connected ({len(_ws_clients)} client(s))")
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            ack_id = msg.get("ack")
            if ack_id is not None:
                fut = _pending_browser_requests.pop(str(ack_id), None)
                if fut and not fut.done():
                    fut.set_result(msg)
    except Exception:
        pass
    finally:
        _ws_clients.discard(ws)
        # If the last browser just disconnected, don't leave in-flight requests
        # hanging for the full timeout — fail them now so tools return promptly.
        if not _ws_clients and _pending_browser_requests:
            for rid, fut in list(_pending_browser_requests.items()):
                if not fut.done():
                    fut.set_result({"ok": False, "reason": "ONEXUS browser disconnected before acknowledging."})
                _pending_browser_requests.pop(rid, None)
        _log(f"browser disconnected ({len(_ws_clients)} client(s) left)")


async def _broadcast(cmd: dict) -> dict:
    """Send a command to all connected browser clients."""
    if not _ws_clients:
        return {"ok": False, "reason": "ONEXUS browser tab not connected. Open ONEXUS and wait for the green dot."}
    payload = json.dumps(cmd)
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send(payload)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)
    if not _ws_clients and dead:
        return {"ok": False, "reason": "All browser connections dropped while sending."}
    return {"ok": True, "sent_to": len(_ws_clients)}


async def _request_browser(cmd: dict) -> dict:
    """Send a command to the live browser graph and wait for its ACK payload."""
    if not _ws_clients:
        return {"ok": False, "reason": "ONEXUS browser tab not connected. Open ONEXUS and wait for the green dot."}

    request_id = uuid.uuid4().hex
    payload = json.dumps({**cmd, "_id": request_id})
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    _pending_browser_requests[request_id] = fut

    # Try clients until one accepts the send; drop any that fail mid-send.
    sent = False
    last_exc: Exception | None = None
    for client in list(_ws_clients):
        try:
            await client.send(payload)
            sent = True
            break
        except Exception as exc:
            last_exc = exc
            _ws_clients.discard(client)
    if not sent:
        _pending_browser_requests.pop(request_id, None)
        return {"ok": False, "reason": f"Failed to send command to ONEXUS browser: {last_exc}"}

    try:
        return await asyncio.wait_for(fut, timeout=CONTROL_TIMEOUT)
    except asyncio.TimeoutError:
        _pending_browser_requests.pop(request_id, None)
        return {"ok": False, "reason": f"ONEXUS browser did not acknowledge '{cmd.get('cmd')}' within {CONTROL_TIMEOUT}s."}


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2)


# ---------------------------------------------------------------------------
# FastMCP lifespan — starts WS server in the same event loop
# ---------------------------------------------------------------------------
def _free_port(port: int) -> None:
    """Kill any OTHER process listening on port (best-effort, Windows)."""
    my_pid = os.getpid()
    try:
        import subprocess
        r = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                try:
                    pid = int(line.split()[-1])
                    if pid != my_pid:
                        subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                       capture_output=True, timeout=5)
                except Exception:
                    pass
    except Exception:
        pass


@asynccontextmanager
async def lifespan(server):
    _free_port(WS_PORT)
    await asyncio.sleep(0.3)
    try:
        async with websockets.serve(
            _ws_handler, "localhost", WS_PORT,
            max_size=WS_MAX_SIZE,   # cap inbound frame size (DoS guard)
            ping_interval=20,       # detect dead connections
            ping_timeout=20,
        ):
            _log(f"WebSocket bridge listening on ws://localhost:{WS_PORT}")
            yield
    except OSError as exc:
        # Port still in use — run without WebSocket (query tools still work)
        _log(f"WebSocket bridge could not bind port {WS_PORT}: {exc}. Live control tools disabled.")
        yield


mcp = FastMCP("onexus", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Query tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_server_info() -> str:
    """Diagnostic: graph file, node/edge counts, WebSocket status."""
    return json.dumps({
        "graph_file": _graph_path_used,
        "node_count": len(_graph.get("nodes", [])),
        "edge_count": len(_graph.get("edges", [])),
        "ws_port": WS_PORT,
        "browser_clients_connected": len(_ws_clients),
        "pending_browser_requests": len(_pending_browser_requests),
    }, indent=2)


@mcp.tool()
def reload_graph() -> str:
    """Reload vault-graph.json from disk without restarting the server."""
    status = _load_graph()
    return json.dumps({
        "status": status,
        "node_count": len(_graph.get("nodes", [])),
        "edge_count": len(_graph.get("edges", [])),
    }, indent=2)


@mcp.tool()
def get_graph_summary() -> str:
    """High-level stats: node/edge counts, breakdown by category, top-10 hubs."""
    nodes = _graph.get("nodes", [])
    edges = _graph.get("edges", [])
    cats: dict[str, int] = {}
    types: dict[str, int] = {}
    for n in nodes:
        d = n.get("data", {})
        c = d.get("category", "?")
        cats[c] = cats.get(c, 0) + 1
        t = d.get("nodeType", "?")
        types[t] = types.get(t, 0) + 1
    deg: dict[str, int] = {}
    for e in edges:
        d = e.get("data", {})
        for k in (d.get("source", ""), d.get("target", "")):
            if k:
                deg[k] = deg.get(k, 0) + 1
    top10 = sorted(deg.items(), key=lambda x: x[1], reverse=True)[:10]
    return json.dumps({
        "node_count": len(nodes),
        "edge_count": len(edges),
        "by_category": cats,
        "by_nodeType": types,
        "top_hubs": [
            {"id": i, "label": _nodes_by_id.get(i, {}).get("displayLabel", i), "degree": d}
            for i, d in top10
        ],
    }, indent=2)


@mcp.tool()
def search_nodes(query: str, limit: int = 20) -> str:
    """Search nodes by label, id, category, status, or tags.

    Args:
        query: Case-insensitive substring to match.
        limit: Max results (default 20, max 100).
    """
    limit = min(max(1, limit), 100)
    q = query.lower()
    results = []
    for n in _graph.get("nodes", []):
        d = n.get("data", {})
        haystack = " ".join(filter(None, [
            d.get("id", ""), d.get("displayLabel", ""), d.get("category", ""),
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
    return json.dumps({"count": len(results), "nodes": results}, indent=2)


@mcp.tool()
def get_node(node_id: str) -> str:
    """Full data + neighbours for one node.

    Args:
        node_id: Node id (e.g. 'projects/ONEXUS.md').
    """
    d = _nodes_by_id.get(node_id)
    if d is None:
        return json.dumps({"error": f"Node '{node_id}' not found."})
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
    }, indent=2)


@mcp.tool()
def get_neighbors(node_id: str, depth: int = 1, direction: str = "both") -> str:
    """All nodes reachable within N hops.

    Args:
        node_id: Starting node id.
        depth: Hops (1-3, default 1).
        direction: 'outgoing', 'incoming', or 'both'.
    """
    depth = min(max(1, depth), 3)
    direction = direction.lower() if direction.lower() in ("outgoing", "incoming", "both") else "both"
    visited: set[str] = {node_id}
    frontier: set[str] = {node_id}
    edges_seen: list[dict] = []
    for _ in range(depth):
        nxt: set[str] = set()
        for e in _graph.get("edges", []):
            ed = e.get("data", {})
            s, t = ed.get("source", ""), ed.get("target", "")
            if direction in ("outgoing", "both") and s in frontier and t not in visited:
                nxt.add(t)
                edges_seen.append({"source": s, "target": t, "type": ed.get("type")})
            if direction in ("incoming", "both") and t in frontier and s not in visited:
                nxt.add(s)
                edges_seen.append({"source": s, "target": t, "type": ed.get("type")})
        visited |= nxt
        frontier = nxt
        if not frontier:
            break
    neighbors = [
        {"id": nid, "label": _nodes_by_id.get(nid, {}).get("displayLabel", nid),
         "category": _nodes_by_id.get(nid, {}).get("category")}
        for nid in visited if nid != node_id
    ]
    return json.dumps({"origin": node_id, "depth": depth,
                       "neighbor_count": len(neighbors),
                       "neighbors": neighbors, "edges": edges_seen}, indent=2)


@mcp.tool()
def find_path(source_id: str, target_id: str) -> str:
    """Shortest path between two nodes (BFS, undirected).

    Args:
        source_id: Starting node id.
        target_id: Destination node id.
    """
    if source_id not in _nodes_by_id:
        return json.dumps({"error": f"Source '{source_id}' not found."})
    if target_id not in _nodes_by_id:
        return json.dumps({"error": f"Target '{target_id}' not found."})
    adj: dict[str, list] = {}
    for e in _graph.get("edges", []):
        ed = e.get("data", {})
        s, t, et = ed.get("source", ""), ed.get("target", ""), ed.get("type", "")
        adj.setdefault(s, []).append((t, et))
        adj.setdefault(t, []).append((s, et))
    from collections import deque
    # Parent-pointer BFS: O(V+E) and O(V) memory, so no artificial node cap is
    # needed (the previous 5000 limit silently returned "not found" on big graphs).
    parent: dict[str, tuple[str, str]] = {}  # node -> (prev_node, edge_type)
    visited: set[str] = {source_id}
    q: deque = deque([source_id])
    found = False
    while q and not found:
        cur = q.popleft()
        for nb, et in adj.get(cur, []):
            if nb in visited:
                continue
            visited.add(nb)
            parent[nb] = (cur, et)
            if nb == target_id:
                found = True
                break
            q.append(nb)
    if not found:
        return json.dumps({"found": False,
                           "message": f"No path between '{source_id}' and '{target_id}'."})
    # Reconstruct path from target back to source.
    fp: list[str] = [target_id]
    etypes: list[str] = []
    cur = target_id
    while cur != source_id:
        prev, et = parent[cur]
        etypes.append(et)
        fp.append(prev)
        cur = prev
    fp.reverse()
    etypes.reverse()
    return json.dumps({
        "found": True, "length": len(fp) - 1, "path": fp,
        "edge_types": etypes,
        "labeled_path": [_nodes_by_id.get(n, {}).get("displayLabel", n) for n in fp],
    }, indent=2)


@mcp.tool()
def get_by_category(category: str, limit: int = 50) -> str:
    """All nodes in a category (case-insensitive prefix match).

    Args:
        category: e.g. 'Project', 'Concept', 'Daily'.
        limit: Max results (default 50, max 200).
    """
    limit = min(max(1, limit), 200)
    q = category.lower()
    results = [
        {"id": d.get("id"), "label": d.get("displayLabel", d.get("id")),
         "status": d.get("status"), "tags": d.get("tags", [])}
        for n in _graph.get("nodes", [])
        if (d := n.get("data", {})) and (d.get("category") or "").lower().startswith(q)
    ][:limit]
    return json.dumps({"category": category, "count": len(results), "nodes": results}, indent=2)


@mcp.tool()
def get_edge_types() -> str:
    """All distinct edge types and their counts."""
    counts: dict[str, int] = {}
    for e in _graph.get("edges", []):
        et = e.get("data", {}).get("type", "unknown")
        counts[et] = counts.get(et, 0) + 1
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return json.dumps({"edge_types": [{"type": t, "count": c} for t, c in ranked]}, indent=2)


# ---------------------------------------------------------------------------
# Control tools (async — run in FastMCP's event loop, same as WS server)
# ---------------------------------------------------------------------------

@mcp.tool()
async def focus_node(node_id: str) -> str:
    """Pan and zoom ONEXUS to a node and flash-highlight it.

    Args:
        node_id: Node id (e.g. 'projects/ONEXUS.md').
    """
    return _dump(await _request_browser({"cmd": "focus_node", "id": node_id}))


@mcp.tool()
async def highlight_nodes(node_ids: list[str], color: str = "#f59e0b") -> str:
    """Color-highlight a set of nodes. Call reset_view() to clear.

    Args:
        node_ids: List of node ids.
        color: CSS color (default amber).
    """
    return _dump(await _request_browser({"cmd": "highlight_nodes", "ids": node_ids, "color": color}))


@mcp.tool()
async def filter_to_subgraph(node_ids: list[str]) -> str:
    """Hide everything except the given nodes. Call reset_view() to restore.

    Args:
        node_ids: Node ids to keep visible.
    """
    return _dump(await _request_browser({"cmd": "filter_subgraph", "ids": node_ids}))


@mcp.tool()
async def reset_view() -> str:
    """Clear all MCP highlights/filters and fit the full graph."""
    return _dump(await _request_browser({"cmd": "reset_view"}))


@mcp.tool()
async def set_layout(layout: str) -> str:
    """Apply a layout in ONEXUS.

    Valid: cose, tree_nested, degree_rings, category_lanes,
    dependency_flow, assembly_chains, compact_grid, system, spatial, responsibility.

    Args:
        layout: Layout name.
    """
    valid = {"cose", "tree_nested", "degree_rings", "category_lanes",
             "dependency_flow", "assembly_chains", "compact_grid",
             "system", "spatial", "responsibility"}
    if layout not in valid:
        return json.dumps({"error": f"Unknown layout '{layout}'. Valid: {sorted(valid)}"})
    return _dump(await _request_browser({"cmd": "set_layout", "layout": layout}))


@mcp.tool()
async def get_live_graph_summary() -> str:
    """Summary of the graph currently loaded in the ONEXUS browser."""
    return _dump(await _request_browser({"cmd": "get_live_graph_summary"}))


@mcp.tool()
async def search_live_nodes(query: str, limit: int = 20) -> str:
    """Search nodes in the graph currently loaded in the ONEXUS browser.

    Args:
        query: Case-insensitive substring to match against id, label, category, status, or tags.
        limit: Max results (default 20, max 100).
    """
    return _dump(await _request_browser({"cmd": "search_live_nodes", "query": query, "limit": limit}))


@mcp.tool()
async def get_live_node(node_id: str) -> str:
    """Full data + live incoming/outgoing edge summaries for one browser node.

    Args:
        node_id: Cytoscape node id in the currently loaded ONEXUS graph.
    """
    return _dump(await _request_browser({"cmd": "get_live_node", "id": node_id}))


@mcp.tool()
async def get_live_neighbors(node_id: str, depth: int = 1, direction: str = "both") -> str:
    """Live nodes reachable from a browser node within N hops.

    Args:
        node_id: Starting Cytoscape node id.
        depth: Hops (1-3, default 1).
        direction: 'outgoing', 'incoming', or 'both'.
    """
    return _dump(await _request_browser({
        "cmd": "get_live_neighbors",
        "id": node_id,
        "depth": depth,
        "direction": direction,
    }))


@mcp.tool()
async def highlight_live_nodes_by_label(query: str, limit: int = 10, color: str = "#f59e0b", focus_first: bool = True) -> str:
    """Search live node labels/ids and highlight matching nodes in ONEXUS.

    Args:
        query: Case-insensitive label/id/category search text.
        limit: Max matches to highlight (default 10, max 50).
        color: CSS color for highlights.
        focus_first: Whether to fit the first matched node after highlighting.
    """
    return _dump(await _request_browser({
        "cmd": "highlight_live_nodes_by_label",
        "query": query,
        "limit": limit,
        "color": color,
        "focus_first": focus_first,
    }))


@mcp.tool()
async def load_focused_graph(nodes: list[dict], edges: list[dict], layout: str = "cose") -> str:
    """Replace the ONEXUS browser canvas with a small custom graph built by the agent.

    Use this to show a focused, purpose-built subgraph instead of the full vault.
    The agent constructs nodes and edges from live data (Revit elements, vault decisions, etc.)
    and pushes them directly into the browser.

    Args:
        nodes: Cytoscape node objects — each must have {data: {id, displayLabel, category, ...}}.
        edges: Cytoscape edge objects — each must have {data: {id, source, target, type}}.
        layout: Layout name to apply after load (default: cose).
    """
    return _dump(await _request_browser({
        "cmd": "load_focused_graph",
        "nodes": nodes,
        "edges": edges,
        "layout": layout,
    }))


@mcp.tool()
async def select_random_live_nodes(count: int = 5, color: str = "#22c55e") -> str:
    """Select and highlight random visible nodes in the currently loaded browser graph.

    Args:
        count: Number of visible nodes to select (default 5, max 50).
        color: CSS color for highlights.
    """
    return _dump(await _request_browser({"cmd": "select_random_live_nodes", "count": count, "color": color}))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport="stdio", show_banner=False)
