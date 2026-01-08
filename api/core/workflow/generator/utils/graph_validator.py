"""
Graph Validator for Workflow Generation

Validates workflow graph structure using graph algorithms:
- Reachability from start node (BFS)
- Reachability to end node (reverse BFS)
- Branch edge validation for if-else and classifier nodes
"""

import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class GraphError:
    """Represents a structural error in the workflow graph."""

    node_id: str
    node_type: str
    error_type: str  # "unreachable", "dead_end", "cycle", "missing_start", "missing_end"
    message: str


@dataclass
class GraphValidationResult:
    """Result of graph validation."""

    success: bool
    errors: list[GraphError] = field(default_factory=list)
    warnings: list[GraphError] = field(default_factory=list)
    execution_time: float = 0.0
    stats: dict = field(default_factory=dict)


class GraphValidator:
    """
    Validates workflow graph structure using proper graph algorithms.

    Performs:
    1. Forward reachability analysis (BFS from start)
    2. Backward reachability analysis (reverse BFS from end)
    3. Branch edge validation for if-else and classifier nodes
    """

    @staticmethod
    def _build_adjacency(
        nodes: dict[str, dict], edges: list[dict]
    ) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
        """Build forward and reverse adjacency lists from edges."""
        outgoing: dict[str, list[str]] = {node_id: [] for node_id in nodes}
        incoming: dict[str, list[str]] = {node_id: [] for node_id in nodes}

        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")
            if source in outgoing and target in incoming:
                outgoing[source].append(target)
                incoming[target].append(source)

        return outgoing, incoming

    @staticmethod
    def _bfs_reachable(start: str, adjacency: dict[str, list[str]]) -> set[str]:
        """BFS to find all nodes reachable from start node."""
        if start not in adjacency:
            return set()

        visited = set()
        queue = deque([start])
        visited.add(start)

        while queue:
            current = queue.popleft()
            for neighbor in adjacency.get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        return visited

    @staticmethod
    def validate(workflow_data: dict) -> GraphValidationResult:
        """Validate workflow graph structure."""
        start_time = time.time()
        errors: list[GraphError] = []
        warnings: list[GraphError] = []

        nodes_list = workflow_data.get("nodes", [])
        edges_list = workflow_data.get("edges", [])
        nodes = {n["id"]: n for n in nodes_list if n.get("id")}

        # Find start and end nodes
        start_node_id = None
        end_node_ids = []

        for node_id, node in nodes.items():
            node_type = node.get("type")
            if node_type == "start":
                start_node_id = node_id
            elif node_type == "end":
                end_node_ids.append(node_id)

        # Check start node exists
        if not start_node_id:
            errors.append(
                GraphError(
                    node_id="workflow",
                    node_type="workflow",
                    error_type="missing_start",
                    message="Workflow has no start node",
                )
            )

        # Check end node exists
        if not end_node_ids:
            errors.append(
                GraphError(
                    node_id="workflow",
                    node_type="workflow",
                    error_type="missing_end",
                    message="Workflow has no end node",
                )
            )

        # If missing start or end, can't do reachability analysis
        if not start_node_id or not end_node_ids:
            execution_time = time.time() - start_time
            return GraphValidationResult(
                success=False,
                errors=errors,
                warnings=warnings,
                execution_time=execution_time,
                stats={"nodes": len(nodes), "edges": len(edges_list)},
            )

        # Build adjacency lists
        outgoing, incoming = GraphValidator._build_adjacency(nodes, edges_list)

        # --- FORWARD REACHABILITY: BFS from start ---
        reachable_from_start = GraphValidator._bfs_reachable(start_node_id, outgoing)

        # Find unreachable nodes
        unreachable_nodes = set(nodes.keys()) - reachable_from_start
        for node_id in unreachable_nodes:
            node = nodes[node_id]
            errors.append(
                GraphError(
                    node_id=node_id,
                    node_type=node.get("type", "unknown"),
                    error_type="unreachable",
                    message=f"Node '{node_id}' is not reachable from start node",
                )
            )

        # --- BACKWARD REACHABILITY: Reverse BFS from end nodes ---
        can_reach_end: set[str] = set()
        for end_id in end_node_ids:
            can_reach_end.update(GraphValidator._bfs_reachable(end_id, incoming))

        # Find dead-end nodes (can't reach any end node)
        dead_end_nodes = set(nodes.keys()) - can_reach_end
        for node_id in dead_end_nodes:
            if node_id in unreachable_nodes:
                continue
            node = nodes[node_id]
            warnings.append(
                GraphError(
                    node_id=node_id,
                    node_type=node.get("type", "unknown"),
                    error_type="dead_end",
                    message=f"Node '{node_id}' cannot reach any end node (dead end)",
                )
            )

        # --- Start node has outgoing edges? ---
        if not outgoing.get(start_node_id):
            errors.append(
                GraphError(
                    node_id=start_node_id,
                    node_type="start",
                    error_type="disconnected",
                    message="Start node has no outgoing connections",
                )
            )

        # --- End nodes have incoming edges? ---
        for end_id in end_node_ids:
            if not incoming.get(end_id):
                errors.append(
                    GraphError(
                        node_id=end_id,
                        node_type="end",
                        error_type="disconnected",
                        message="End node has no incoming connections",
                    )
                )

        # --- BRANCH EDGE VALIDATION ---
        edge_handles: dict[str, set[str]] = {}
        for edge in edges_list:
            source = edge.get("source")
            handle = edge.get("sourceHandle", "")
            if source:
                if source not in edge_handles:
                    edge_handles[source] = set()
                edge_handles[source].add(handle)

        # Check if-else and question-classifier nodes
        for node_id, node in nodes.items():
            node_type = node.get("type")

            if node_type == "if-else":
                handles = edge_handles.get(node_id, set())
                config = node.get("config", {})
                cases = config.get("cases", [])

                required_handles = set()
                for case in cases:
                    case_id = case.get("case_id")
                    if case_id:
                        required_handles.add(case_id)
                required_handles.add("false")

                missing = required_handles - handles
                for handle in missing:
                    errors.append(
                        GraphError(
                            node_id=node_id,
                            node_type=node_type,
                            error_type="missing_branch",
                            message=f"If-else node '{node_id}' missing edge for branch '{handle}'",
                        )
                    )

            elif node_type == "question-classifier":
                handles = edge_handles.get(node_id, set())
                config = node.get("config", {})
                classes = config.get("classes", [])

                required_handles = set()
                for cls in classes:
                    if isinstance(cls, dict):
                        cls_id = cls.get("id")
                        if cls_id:
                            required_handles.add(cls_id)

                missing = required_handles - handles
                for handle in missing:
                    cls_name = handle
                    for cls in classes:
                        if isinstance(cls, dict) and cls.get("id") == handle:
                            cls_name = cls.get("name", handle)
                            break
                    errors.append(
                        GraphError(
                            node_id=node_id,
                            node_type=node_type,
                            error_type="missing_branch",
                            message=f"Classifier '{node_id}' missing edge for class '{cls_name}'",
                        )
                    )

        execution_time = time.time() - start_time
        success = len(errors) == 0

        return GraphValidationResult(
            success=success,
            errors=errors,
            warnings=warnings,
            execution_time=execution_time,
            stats={
                "nodes": len(nodes),
                "edges": len(edges_list),
                "reachable_from_start": len(reachable_from_start),
                "can_reach_end": len(can_reach_end),
                "unreachable": len(unreachable_nodes),
                "dead_ends": len(dead_end_nodes - unreachable_nodes),
            },
        )
