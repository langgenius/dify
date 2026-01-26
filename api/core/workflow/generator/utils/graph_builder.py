"""
GraphBuilder: Automatic workflow graph construction from node list.

This module implements the core logic for building complete workflow graphs
from LLM-generated node lists with dependency declarations.

Key features:
- Automatic start/end node generation
- Dependency inference from variable references
- Topological sorting with cycle detection
- Special handling for branching nodes (if-else, question-classifier)
- Silent error recovery where possible
"""

import json
import logging
import re
import uuid
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)

# Pattern to match variable references like {{#node_id.field#}}
VAR_PATTERN = re.compile(r"\{\{#([^.#]+)\.[^#]+#\}\}")

# System variable prefixes to exclude from dependency inference
SYSTEM_VAR_PREFIXES = {"sys", "start", "env"}

# Node types that have special branching behavior
BRANCHING_NODE_TYPES = {"if-else", "question-classifier"}

# Container node types (iteration, loop) - these have internal subgraphs
# but behave as single-input-single-output nodes in the external graph
CONTAINER_NODE_TYPES = {"iteration", "loop"}


class GraphBuildError(Exception):
    """Raised when graph cannot be built due to unrecoverable errors."""

    pass


class CyclicDependencyError(GraphBuildError):
    """Raised when cyclic dependencies are detected."""

    pass


class GraphBuilder:
    """
    Builds complete workflow graphs from LLM-generated node lists.

    This class handles the conversion from a simplified node list format
    (with depends_on declarations) to a full workflow graph with nodes and edges.

    The LLM only needs to generate:
    - Node configurations with depends_on arrays
    - Branch targets in config for branching nodes

    The GraphBuilder automatically:
    - Adds start and end nodes
    - Generates all edges from dependencies
    - Infers implicit dependencies from variable references
    - Handles branching nodes (if-else, question-classifier)
    - Validates graph structure (no cycles, proper connectivity)
    """

    @classmethod
    def build_graph(
        cls,
        nodes: list[dict[str, Any]],
        start_config: dict[str, Any] | None = None,
        end_config: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        Build a complete workflow graph from a node list.

        Args:
            nodes: LLM-generated nodes (without start/end)
            start_config: Optional configuration for start node
            end_config: Optional configuration for end node

        Returns:
            Tuple of (complete_nodes, edges) where:
            - complete_nodes includes start, user nodes, and end
            - edges contains all connections

        Raises:
            CyclicDependencyError: If cyclic dependencies are detected
            GraphBuildError: If graph cannot be built
        """
        if not nodes:
            # Empty node list - create minimal workflow
            start_node = cls._create_start_node([], start_config)
            end_node = cls._create_end_node([], end_config)
            edge = cls._create_edge("start", "end")
            return [start_node, end_node], [edge]

        # Build node index for quick lookup
        node_map = {node["id"]: node for node in nodes}

        # Step 1: Extract explicit dependencies from depends_on
        dependencies = cls._extract_explicit_dependencies(nodes)

        # Step 2: Infer implicit dependencies from variable references
        dependencies = cls._infer_dependencies_from_variables(nodes, dependencies, node_map)

        # Step 3: Validate and fix dependencies (remove invalid references)
        dependencies = cls._validate_dependencies(dependencies, node_map)

        # Step 4: Topological sort (detects cycles)
        sorted_node_ids = cls._topological_sort(nodes, dependencies)

        # Step 5: Generate start node
        start_node = cls._create_start_node(nodes, start_config)

        # Step 6: Generate edges
        edges = cls._generate_edges(nodes, sorted_node_ids, dependencies, node_map)

        # Step 7: Find terminal nodes and generate end node
        terminal_nodes = cls._find_terminal_nodes(nodes, dependencies, node_map)
        end_node = cls._create_end_node(terminal_nodes, end_config)

        # Step 8: Add edges from terminal nodes to end
        for terminal_id in terminal_nodes:
            edges.append(cls._create_edge(terminal_id, "end"))

        # Step 9: Assemble complete node list
        all_nodes = [start_node, *nodes, end_node]

        return all_nodes, edges

    @classmethod
    def _extract_explicit_dependencies(
        cls,
        nodes: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """
        Extract explicit dependencies from depends_on field.

        Args:
            nodes: List of nodes with optional depends_on field

        Returns:
            Dictionary mapping node_id -> list of dependency node_ids
        """
        dependencies: dict[str, list[str]] = {}

        for node in nodes:
            node_id = node.get("id", "")
            depends_on = node.get("depends_on", [])

            # Ensure depends_on is a list
            if isinstance(depends_on, str):
                depends_on = [depends_on] if depends_on else []
            elif not isinstance(depends_on, list):
                depends_on = []

            dependencies[node_id] = list(depends_on)

        return dependencies

    @classmethod
    def _infer_dependencies_from_variables(
        cls,
        nodes: list[dict[str, Any]],
        explicit_deps: dict[str, list[str]],
        node_map: dict[str, dict[str, Any]],
    ) -> dict[str, list[str]]:
        """
        Infer implicit dependencies from variable references in config.

        Scans node configurations for patterns like {{#node_id.field#}}
        and adds those as dependencies if not already declared.

        Args:
            nodes: List of nodes
            explicit_deps: Already extracted explicit dependencies
            node_map: Map of node_id -> node for validation

        Returns:
            Updated dependencies dictionary
        """
        for node in nodes:
            node_id = node.get("id", "")
            config = node.get("config", {})

            # Serialize config to search for variable references
            try:
                config_str = json.dumps(config, ensure_ascii=False)
            except (TypeError, ValueError):
                continue

            # Find all variable references
            referenced_nodes = set(VAR_PATTERN.findall(config_str))

            # Filter out system variables
            referenced_nodes -= SYSTEM_VAR_PREFIXES

            # Ensure node_id exists in dependencies
            if node_id not in explicit_deps:
                explicit_deps[node_id] = []

            # Add inferred dependencies
            for ref in referenced_nodes:
                # Skip self-references (e.g., loop nodes referencing their own outputs)
                if ref == node_id:
                    logger.debug(
                        "Skipping self-reference: %s -> %s",
                        node_id,
                        ref,
                    )
                    continue

                if ref in node_map and ref not in explicit_deps[node_id]:
                    explicit_deps[node_id].append(ref)
                    logger.debug(
                        "Inferred dependency: %s -> %s (from variable reference)",
                        node_id,
                        ref,
                    )

        return explicit_deps

    @classmethod
    def _validate_dependencies(
        cls,
        dependencies: dict[str, list[str]],
        node_map: dict[str, dict[str, Any]],
    ) -> dict[str, list[str]]:
        """
        Validate dependencies and remove invalid references.

        Silent fix: References to non-existent nodes are removed.

        Args:
            dependencies: Dependencies to validate
            node_map: Map of valid node IDs

        Returns:
            Validated dependencies
        """
        valid_deps: dict[str, list[str]] = {}

        for node_id, deps in dependencies.items():
            valid_deps[node_id] = []
            for dep in deps:
                if dep in node_map:
                    valid_deps[node_id].append(dep)
                else:
                    logger.warning(
                        "Removed invalid dependency: %s -> %s (node does not exist)",
                        node_id,
                        dep,
                    )

        return valid_deps

    @classmethod
    def _topological_sort(
        cls,
        nodes: list[dict[str, Any]],
        dependencies: dict[str, list[str]],
    ) -> list[str]:
        """
        Perform topological sort on nodes based on dependencies.

        Uses Kahn's algorithm for cycle detection.

        Args:
            nodes: List of nodes
            dependencies: Dependency graph

        Returns:
            List of node IDs in topological order

        Raises:
            CyclicDependencyError: If cyclic dependencies are detected
        """
        # Build in-degree map
        in_degree: dict[str, int] = defaultdict(int)
        reverse_deps: dict[str, list[str]] = defaultdict(list)

        node_ids = {node["id"] for node in nodes}

        for node_id in node_ids:
            in_degree[node_id] = 0

        for node_id, deps in dependencies.items():
            for dep in deps:
                if dep in node_ids:
                    in_degree[node_id] += 1
                    reverse_deps[dep].append(node_id)

        # Start with nodes that have no dependencies
        queue = [nid for nid in node_ids if in_degree[nid] == 0]
        sorted_ids: list[str] = []

        while queue:
            current = queue.pop(0)
            sorted_ids.append(current)

            for dependent in reverse_deps[current]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)

        # Check for cycles
        if len(sorted_ids) != len(node_ids):
            remaining = node_ids - set(sorted_ids)
            raise CyclicDependencyError(
                f"Cyclic dependency detected involving nodes: {remaining}"
            )

        return sorted_ids

    @classmethod
    def _generate_edges(
        cls,
        nodes: list[dict[str, Any]],
        sorted_node_ids: list[str],
        dependencies: dict[str, list[str]],
        node_map: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Generate all edges based on dependencies and special node handling.

        Args:
            nodes: List of nodes
            sorted_node_ids: Topologically sorted node IDs
            dependencies: Dependency graph
            node_map: Map of node_id -> node

        Returns:
            List of edge dictionaries
        """
        edges: list[dict[str, Any]] = []
        nodes_with_incoming: set[str] = set()

        # Track which nodes have outgoing edges from branching
        branching_sources: set[str] = set()

        # First pass: Handle branching nodes
        for node in nodes:
            node_id = node.get("id", "")
            node_type = node.get("type", "")

            if node_type == "if-else":
                branch_edges = cls._handle_if_else_node(node)
                edges.extend(branch_edges)
                branching_sources.add(node_id)
                nodes_with_incoming.update(edge["target"] for edge in branch_edges)

            elif node_type == "question-classifier":
                branch_edges = cls._handle_question_classifier_node(node)
                edges.extend(branch_edges)
                branching_sources.add(node_id)
                nodes_with_incoming.update(edge["target"] for edge in branch_edges)

        # Second pass: Generate edges from dependencies
        for node_id in sorted_node_ids:
            deps = dependencies.get(node_id, [])

            if deps:
                # Connect from each dependency
                for dep_id in deps:
                    dep_node = node_map.get(dep_id, {})
                    dep_type = dep_node.get("type", "")

                    # Skip if dependency is a branching node (edges handled above)
                    if dep_type in BRANCHING_NODE_TYPES:
                        continue

                    edges.append(cls._create_edge(dep_id, node_id))
                    nodes_with_incoming.add(node_id)
            else:
                # No dependencies - connect from start
                # But skip if this node receives edges from branching nodes
                if node_id not in nodes_with_incoming:
                    edges.append(cls._create_edge("start", node_id))
                    nodes_with_incoming.add(node_id)

        return edges

    @classmethod
    def _handle_if_else_node(
        cls,
        node: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Handle if-else node branching.

        Expects config to contain true_branch and/or false_branch.

        Args:
            node: If-else node

        Returns:
            List of branch edges
        """
        edges: list[dict[str, Any]] = []
        node_id = node.get("id", "")
        config = node.get("config", {})

        true_branch = config.get("true_branch")
        false_branch = config.get("false_branch")

        if true_branch:
            edges.append(cls._create_edge(node_id, true_branch, source_handle="true"))

        if false_branch:
            edges.append(cls._create_edge(node_id, false_branch, source_handle="false"))

        # If no branches specified, log warning
        if not true_branch and not false_branch:
            logger.warning(
                "if-else node %s has no branch targets specified",
                node_id,
            )

        return edges

    @classmethod
    def _handle_question_classifier_node(
        cls,
        node: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Handle question-classifier node branching.

        Expects config.classes to contain class definitions with target fields.

        Args:
            node: Question-classifier node

        Returns:
            List of branch edges
        """
        edges: list[dict[str, Any]] = []
        node_id = node.get("id", "")
        config = node.get("config", {})
        classes = config.get("classes", [])

        if not classes:
            logger.warning(
                "question-classifier node %s has no classes defined",
                node_id,
            )
            return edges

        for cls_def in classes:
            class_id = cls_def.get("id", "")
            target = cls_def.get("target")

            if target:
                edges.append(cls._create_edge(node_id, target, source_handle=class_id))
            else:
                # Silent fix: Connect to end if no target specified
                edges.append(cls._create_edge(node_id, "end", source_handle=class_id))
                logger.debug(
                    "question-classifier class %s has no target, connecting to end",
                    class_id,
                )

        return edges

    @classmethod
    def _find_terminal_nodes(
        cls,
        nodes: list[dict[str, Any]],
        dependencies: dict[str, list[str]],
        node_map: dict[str, dict[str, Any]],
    ) -> list[str]:
        """
        Find nodes that should connect to the end node.

        Terminal nodes are those that:
        - Are not dependencies of any other node
        - Are not branching nodes (those connect to their branches)

        Args:
            nodes: List of nodes
            dependencies: Dependency graph
            node_map: Map of node_id -> node

        Returns:
            List of terminal node IDs
        """
        # Build set of all nodes that are depended upon
        depended_upon: set[str] = set()
        for deps in dependencies.values():
            depended_upon.update(deps)

        # Also track nodes that are branch targets
        branch_targets: set[str] = set()
        branching_nodes: set[str] = set()

        for node in nodes:
            node_id = node.get("id", "")
            node_type = node.get("type", "")
            config = node.get("config", {})

            if node_type == "if-else":
                branching_nodes.add(node_id)
                if config.get("true_branch"):
                    branch_targets.add(config["true_branch"])
                if config.get("false_branch"):
                    branch_targets.add(config["false_branch"])

            elif node_type == "question-classifier":
                branching_nodes.add(node_id)
                for cls_def in config.get("classes", []):
                    if cls_def.get("target"):
                        branch_targets.add(cls_def["target"])

        # Find terminal nodes
        terminal_nodes: list[str] = []
        for node in nodes:
            node_id = node.get("id", "")
            node_type = node.get("type", "")

            # Skip branching nodes - they don't connect to end directly
            if node_type in BRANCHING_NODE_TYPES:
                continue

            # Terminal if not depended upon and not a branch target that leads elsewhere
            if node_id not in depended_upon:
                terminal_nodes.append(node_id)

        # If no terminal nodes found (shouldn't happen), use all non-branching nodes
        if not terminal_nodes:
            terminal_nodes = [
                node["id"]
                for node in nodes
                if node.get("type") not in BRANCHING_NODE_TYPES
            ]
            logger.warning("No terminal nodes found, using all non-branching nodes")

        return terminal_nodes

    @classmethod
    def _create_start_node(
        cls,
        nodes: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Create a start node.

        Args:
            nodes: User nodes (for potential config inference)
            config: Optional start node configuration

        Returns:
            Start node dictionary
        """
        return {
            "id": "start",
            "type": "start",
            "title": "Start",
            "config": config or {},
            "data": {},
        }

    @classmethod
    def _create_end_node(
        cls,
        terminal_nodes: list[str],
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Create an end node.

        Args:
            terminal_nodes: Nodes that will connect to end
            config: Optional end node configuration

        Returns:
            End node dictionary
        """
        return {
            "id": "end",
            "type": "end",
            "title": "End",
            "config": config or {},
            "data": {},
        }

    @classmethod
    def _create_edge(
        cls,
        source: str,
        target: str,
        source_handle: str | None = None,
    ) -> dict[str, Any]:
        """
        Create an edge dictionary.

        Args:
            source: Source node ID
            target: Target node ID
            source_handle: Optional handle for branching (e.g., "true", "false", class_id)

        Returns:
            Edge dictionary
        """
        edge: dict[str, Any] = {
            "id": f"{source}-{target}-{uuid.uuid4().hex[:8]}",
            "source": source,
            "target": target,
        }

        if source_handle:
            edge["sourceHandle"] = source_handle
        else:
            edge["sourceHandle"] = "source"

        edge["targetHandle"] = "target"

        return edge
