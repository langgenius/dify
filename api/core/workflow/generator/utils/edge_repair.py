"""
Edge Repair Utility for Vibe Workflow Generation.

This module provides intelligent edge repair capabilities for generated workflows.
It can detect and fix common edge issues:
- Missing edges between sequential nodes
- Incomplete branches for question-classifier and if-else nodes
- Orphaned nodes without connections

The repair logic is deterministic and doesn't require LLM calls.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class RepairResult:
    """Result of edge repair operation."""

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    repairs_made: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def was_repaired(self) -> bool:
        """Check if any repairs were made."""
        return len(self.repairs_made) > 0


class EdgeRepair:
    """
    Intelligent edge repair for workflow graphs.

    Repairs are applied in order:
    1. Infer linear connections from node order (if no edges exist)
    2. Add missing branch edges for question-classifier
    3. Add missing branch edges for if-else
    4. Connect orphaned nodes
    """

    @classmethod
    def repair(cls, workflow_data: dict[str, Any]) -> RepairResult:
        """
        Repair edges in the workflow data.

        Args:
            workflow_data: Dict containing 'nodes' and 'edges'

        Returns:
            RepairResult with repaired nodes, edges, and repair logs
        """
        nodes = list(workflow_data.get("nodes", []))
        edges = list(workflow_data.get("edges", []))
        repairs: list[str] = []
        warnings: list[str] = []

        logger.info("[EdgeRepair] Starting repair: %d nodes, %d edges", len(nodes), len(edges))

        # Build node lookup
        node_map = {n.get("id"): n for n in nodes if n.get("id")}
        node_ids = set(node_map.keys())

        # 1. If no edges at all, infer linear chain
        if not edges and len(nodes) > 1:
            edges, inferred_repairs = cls._infer_linear_chain(nodes)
            repairs.extend(inferred_repairs)

        # 2. Build edge index for analysis
        outgoing_edges: dict[str, list[dict[str, Any]]] = {}
        incoming_edges: dict[str, list[dict[str, Any]]] = {}
        for edge in edges:
            src = edge.get("source")
            tgt = edge.get("target")
            if src:
                outgoing_edges.setdefault(src, []).append(edge)
            if tgt:
                incoming_edges.setdefault(tgt, []).append(edge)

        # 3. Repair question-classifier branches
        for node in nodes:
            if node.get("type") == "question-classifier":
                new_edges, branch_repairs, branch_warnings = cls._repair_classifier_branches(
                    node, edges, outgoing_edges, node_ids
                )
                edges.extend(new_edges)
                repairs.extend(branch_repairs)
                warnings.extend(branch_warnings)
                # Update outgoing index
                for edge in new_edges:
                    outgoing_edges.setdefault(edge.get("source"), []).append(edge)

        # 4. Repair if-else branches
        for node in nodes:
            if node.get("type") == "if-else":
                new_edges, branch_repairs, branch_warnings = cls._repair_if_else_branches(
                    node, edges, outgoing_edges, node_ids
                )
                edges.extend(new_edges)
                repairs.extend(branch_repairs)
                warnings.extend(branch_warnings)
                # Update outgoing index
                for edge in new_edges:
                    outgoing_edges.setdefault(edge.get("source"), []).append(edge)

        # 5. Connect orphaned nodes (nodes with no incoming edge, except start)
        new_edges, orphan_repairs = cls._connect_orphaned_nodes(
            nodes, edges, outgoing_edges, incoming_edges
        )
        edges.extend(new_edges)
        repairs.extend(orphan_repairs)

        # 6. Connect nodes with no outgoing edge to 'end' (except end nodes)
        new_edges, terminal_repairs = cls._connect_terminal_nodes(
            nodes, edges, outgoing_edges
        )
        edges.extend(new_edges)
        repairs.extend(terminal_repairs)

        logger.info("[EdgeRepair] Completed: %d repairs made, %d warnings", len(repairs), len(warnings))
        for r in repairs:
            logger.info("[EdgeRepair] Repair: %s", r)
        for w in warnings:
            logger.info("[EdgeRepair] Warning: %s", w)

        return RepairResult(
            nodes=nodes,
            edges=edges,
            repairs_made=repairs,
            warnings=warnings,
        )

    @classmethod
    def _infer_linear_chain(cls, nodes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
        """
        Infer a linear chain of edges from node order.

        This is used when no edges are provided at all.
        """
        edges: list[dict[str, Any]] = []
        repairs: list[str] = []

        # Filter to get ordered node IDs
        node_ids = [n.get("id") for n in nodes if n.get("id")]

        if len(node_ids) < 2:
            return edges, repairs

        # Create edges between consecutive nodes
        for i in range(len(node_ids) - 1):
            src = node_ids[i]
            tgt = node_ids[i + 1]
            edges.append({"source": src, "target": tgt})
            repairs.append(f"Inferred edge: {src} -> {tgt}")

        logger.info("[EdgeRepair] Inferred %d edges from node order (no edges provided)", len(edges))
        return edges, repairs

    @classmethod
    def _repair_classifier_branches(
        cls,
        node: dict[str, Any],
        edges: list[dict[str, Any]],
        outgoing_edges: dict[str, list[dict[str, Any]]],
        valid_node_ids: set[str],
    ) -> tuple[list[dict[str, Any]], list[str], list[str]]:
        """
        Repair missing branches for question-classifier nodes.

        For each class that doesn't have an edge, create one pointing to 'end'.
        """
        new_edges: list[dict[str, Any]] = []
        repairs: list[str] = []
        warnings: list[str] = []

        node_id = node.get("id")
        if not node_id:
            return new_edges, repairs, warnings

        config = node.get("config", {})
        classes = config.get("classes", [])

        if not classes:
            return new_edges, repairs, warnings

        # Get existing sourceHandles for this node
        existing_handles = set()
        for edge in outgoing_edges.get(node_id, []):
            handle = edge.get("sourceHandle")
            if handle:
                existing_handles.add(handle)

        # Find 'end' node as default target
        end_node_id = "end"
        if "end" not in valid_node_ids:
            # Try to find an end node
            for nid in valid_node_ids:
                if "end" in nid.lower():
                    end_node_id = nid
                    break

        # Add missing branches
        for cls_def in classes:
            if not isinstance(cls_def, dict):
                continue
            cls_id = cls_def.get("id")
            cls_name = cls_def.get("name", cls_id)

            if cls_id and cls_id not in existing_handles:
                new_edge = {
                    "source": node_id,
                    "sourceHandle": cls_id,
                    "target": end_node_id,
                }
                new_edges.append(new_edge)
                repairs.append(f"Added missing branch edge for class '{cls_name}' -> {end_node_id}")
                warnings.append(
                    f"Auto-connected question-classifier branch '{cls_name}' to '{end_node_id}'. "
                    "You may want to redirect this to a specific handler node."
                )

        return new_edges, repairs, warnings

    @classmethod
    def _repair_if_else_branches(
        cls,
        node: dict[str, Any],
        edges: list[dict[str, Any]],
        outgoing_edges: dict[str, list[dict[str, Any]]],
        valid_node_ids: set[str],
    ) -> tuple[list[dict[str, Any]], list[str], list[str]]:
        """
        Repair missing true/false branches for if-else nodes.
        """
        new_edges: list[dict[str, Any]] = []
        repairs: list[str] = []
        warnings: list[str] = []

        node_id = node.get("id")
        if not node_id:
            return new_edges, repairs, warnings

        # Get existing sourceHandles
        existing_handles = set()
        for edge in outgoing_edges.get(node_id, []):
            handle = edge.get("sourceHandle")
            if handle:
                existing_handles.add(handle)

        # Find 'end' node as default target
        end_node_id = "end"
        if "end" not in valid_node_ids:
            for nid in valid_node_ids:
                if "end" in nid.lower():
                    end_node_id = nid
                    break

        # Add missing branches
        required_branches = ["true", "false"]
        for branch in required_branches:
            if branch not in existing_handles:
                new_edge = {
                    "source": node_id,
                    "sourceHandle": branch,
                    "target": end_node_id,
                }
                new_edges.append(new_edge)
                repairs.append(f"Added missing if-else '{branch}' branch -> {end_node_id}")
                warnings.append(
                    f"Auto-connected if-else '{branch}' branch to '{end_node_id}'. "
                    "You may want to redirect this to a specific handler node."
                )

        return new_edges, repairs, warnings

    @classmethod
    def _connect_orphaned_nodes(
        cls,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        outgoing_edges: dict[str, list[dict[str, Any]]],
        incoming_edges: dict[str, list[dict[str, Any]]],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """
        Connect orphaned nodes to the previous node in sequence.

        An orphaned node has no incoming edges and is not a 'start' node.
        """
        new_edges: list[dict[str, Any]] = []
        repairs: list[str] = []

        node_ids = [n.get("id") for n in nodes if n.get("id")]
        node_types = {n.get("id"): n.get("type") for n in nodes}

        for i, node_id in enumerate(node_ids):
            node_type = node_types.get(node_id)

            # Skip start nodes - they don't need incoming edges
            if node_type == "start":
                continue

            # Check if node has incoming edges
            if node_id not in incoming_edges or not incoming_edges[node_id]:
                # Find previous node to connect from
                if i > 0:
                    prev_node_id = node_ids[i - 1]
                    new_edge = {"source": prev_node_id, "target": node_id}
                    new_edges.append(new_edge)
                    repairs.append(f"Connected orphaned node: {prev_node_id} -> {node_id}")

                    # Update incoming_edges for subsequent checks
                    incoming_edges.setdefault(node_id, []).append(new_edge)

        return new_edges, repairs

    @classmethod
    def _connect_terminal_nodes(
        cls,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        outgoing_edges: dict[str, list[dict[str, Any]]],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """
        Connect terminal nodes (no outgoing edges) to 'end'.

        A terminal node has no outgoing edges and is not an 'end' node.
        This ensures all branches eventually reach 'end'.
        """
        new_edges: list[dict[str, Any]] = []
        repairs: list[str] = []

        # Find end node
        end_node_id = None
        node_ids = set()
        for n in nodes:
            nid = n.get("id")
            ntype = n.get("type")
            if nid:
                node_ids.add(nid)
            if ntype == "end":
                end_node_id = nid

        if not end_node_id:
            # No end node found, can't connect
            return new_edges, repairs

        for node in nodes:
            node_id = node.get("id")
            node_type = node.get("type")

            # Skip end nodes
            if node_type == "end":
                continue

            # Skip nodes that already have outgoing edges
            if outgoing_edges.get(node_id):
                continue

            # Connect to end
            new_edge = {"source": node_id, "target": end_node_id}
            new_edges.append(new_edge)
            repairs.append(f"Connected terminal node to end: {node_id} -> {end_node_id}")

            # Update for subsequent checks
            outgoing_edges.setdefault(node_id, []).append(new_edge)

        return new_edges, repairs

