"""Pure graph-grounding helpers shared by MCP tools and tests."""
from __future__ import annotations

from collections import deque
from typing import Any


def _relationship(edge_data: dict[str, Any]) -> dict[str, Any]:
    rel = edge_data.get("relationship")
    if isinstance(rel, dict):
        return rel
    inferred = str(edge_data.get("confidence", "")).lower() == "inferred"
    return {
        "contract": "onexus.relationship.v1",
        "truthClass": "inferred" if inferred else "source-native",
        "source": {"system": edge_data.get("sourceSystem", "unknown"), "recordId": edge_data.get("externalId", ""), "url": edge_data.get("externalUrl", "")},
        "provenance": {"method": "inference" if inferred else "legacy", "evidenceIds": edge_data.get("evidenceIds", [])},
        "confidence": edge_data.get("confidence", "Explicit"),
        "validity": {"status": "active"},
        "review": {"status": "proposed" if inferred else "unreviewed"},
        "lifecycle": {"deleted": bool(edge_data.get("deletedReference"))},
    }


def grounded_path(graph: dict[str, Any], source_id: str, target_id: str,
                  allowed_truth_classes: list[str] | None = None,
                  include_rejected: bool = False) -> dict[str, Any]:
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    node_map = {n.get("data", {}).get("id"): n.get("data", {}) for n in nodes if n.get("data", {}).get("id")}
    if source_id not in node_map:
        return {"error": f"Source '{source_id}' not found."}
    if target_id not in node_map:
        return {"error": f"Target '{target_id}' not found."}

    allowed = {x.lower() for x in allowed_truth_classes} if allowed_truth_classes else None
    adjacency: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    excluded = {"truth_class": 0, "rejected": 0, "deleted": 0}
    for wrapped in edges:
        data = wrapped.get("data", {})
        source, target = data.get("source"), data.get("target")
        if not source or not target:
            continue
        rel = _relationship(data)
        truth = str(rel.get("truthClass", "source-native")).lower()
        if allowed is not None and truth not in allowed:
            excluded["truth_class"] += 1
            continue
        if not include_rejected and rel.get("review", {}).get("status") == "rejected":
            excluded["rejected"] += 1
            continue
        if rel.get("lifecycle", {}).get("deleted") is True:
            excluded["deleted"] += 1
            continue
        adjacency.setdefault(source, []).append((target, data))
        adjacency.setdefault(target, []).append((source, data))

    queue = deque([source_id])
    parent: dict[str, tuple[str, dict[str, Any]]] = {}
    visited = {source_id}
    while queue:
        current = queue.popleft()
        if current == target_id:
            break
        for neighbor, edge in adjacency.get(current, []):
            if neighbor in visited:
                continue
            visited.add(neighbor)
            parent[neighbor] = (current, edge)
            queue.append(neighbor)

    if target_id not in visited:
        return {"found": False, "source": source_id, "target": target_id, "excluded_edges": excluded}

    path_ids = [target_id]
    path_edges: list[dict[str, Any]] = []
    current = target_id
    while current != source_id:
        previous, edge = parent[current]
        rel = _relationship(edge)
        path_edges.append({
            "id": edge.get("id"), "source": edge.get("source"), "target": edge.get("target"),
            "type": edge.get("type"), "dimension": edge.get("dimension"),
            "truthClass": rel.get("truthClass"), "sourceRecord": rel.get("source", {}),
            "provenance": rel.get("provenance", {}), "confidence": rel.get("confidence"),
            "validity": rel.get("validity", {}), "review": rel.get("review", {}),
        })
        path_ids.append(previous)
        current = previous
    path_ids.reverse()
    path_edges.reverse()
    path_nodes = [{"id": node_id, "label": node_map[node_id].get("displayLabel", node_map[node_id].get("label", node_id)),
                   "category": node_map[node_id].get("category"), "data": node_map[node_id]} for node_id in path_ids]
    evidence_ids = sorted({str(evidence) for edge in path_edges for evidence in edge.get("provenance", {}).get("evidenceIds", [])})
    return {
        "found": True, "length": len(path_edges), "source": source_id, "target": target_id,
        "nodes": path_nodes, "edges": path_edges, "evidence_ids": evidence_ids,
        "grounding": {"inspectable": True, "excluded_edges": excluded,
                      "allowed_truth_classes": sorted(allowed) if allowed else "all", "include_rejected": include_rejected},
    }
