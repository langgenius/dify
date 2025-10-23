import logging
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Protocol, cast, final

from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeState, NodeType
from core.workflow.nodes.base.node import Node
from libs.typing import is_str, is_str_dict

from .edge import Edge
from .validation import get_graph_validator

logger = logging.getLogger(__name__)


class NodeFactory(Protocol):
    """
    Protocol for creating Node instances from node data dictionaries.

    This protocol decouples the Graph class from specific node mapping implementations,
    allowing for different node creation strategies while maintaining type safety.
    """

    def create_node(self, node_config: dict[str, object]) -> Node:
        """
        Create a Node instance from node configuration data.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node type is unknown or configuration is invalid
        """
        ...


@final
class Graph:
    """Graph representation with nodes and edges for workflow execution."""

    def __init__(
        self,
        *,
        nodes: dict[str, Node] | None = None,
        edges: dict[str, Edge] | None = None,
        in_edges: dict[str, list[str]] | None = None,
        out_edges: dict[str, list[str]] | None = None,
        root_node: Node,
    ):
        """
        Initialize Graph instance.

        :param nodes: graph nodes mapping (node id: node object)
        :param edges: graph edges mapping (edge id: edge object)
        :param in_edges: incoming edges mapping (node id: list of edge ids)
        :param out_edges: outgoing edges mapping (node id: list of edge ids)
        :param root_node: root node object
        """
        self.nodes = nodes or {}
        self.edges = edges or {}
        self.in_edges = in_edges or {}
        self.out_edges = out_edges or {}
        self.root_node = root_node

    @classmethod
    def _parse_node_configs(cls, node_configs: list[dict[str, object]]) -> dict[str, dict[str, object]]:
        """
        Parse node configurations and build a mapping of node IDs to configs.

        :param node_configs: list of node configuration dictionaries
        :return: mapping of node ID to node config
        """
        node_configs_map: dict[str, dict[str, object]] = {}

        for node_config in node_configs:
            node_id = node_config.get("id")
            if not node_id or not isinstance(node_id, str):
                continue

            node_configs_map[node_id] = node_config

        return node_configs_map

    @classmethod
    def _find_root_node_id(
        cls,
        node_configs_map: Mapping[str, Mapping[str, object]],
        edge_configs: Sequence[Mapping[str, object]],
        root_node_id: str | None = None,
    ) -> str:
        """
        Find the root node ID if not specified.

        :param node_configs_map: mapping of node ID to node config
        :param edge_configs: list of edge configurations
        :param root_node_id: explicitly specified root node ID
        :return: determined root node ID
        """
        if root_node_id:
            if root_node_id not in node_configs_map:
                raise ValueError(f"Root node id {root_node_id} not found in the graph")
            return root_node_id

        # Find nodes with no incoming edges
        nodes_with_incoming: set[str] = set()
        for edge_config in edge_configs:
            target = edge_config.get("target")
            if isinstance(target, str):
                nodes_with_incoming.add(target)

        root_candidates = [nid for nid in node_configs_map if nid not in nodes_with_incoming]

        # Prefer START node if available
        start_node_id = None
        for nid in root_candidates:
            node_data = node_configs_map[nid].get("data")
            if not is_str_dict(node_data):
                continue
            node_type = node_data.get("type")
            if not isinstance(node_type, str):
                continue
            if node_type in [NodeType.START, NodeType.DATASOURCE]:
                start_node_id = nid
                break

        root_node_id = start_node_id or (root_candidates[0] if root_candidates else None)

        if not root_node_id:
            raise ValueError("Unable to determine root node ID")

        return root_node_id

    @classmethod
    def _build_edges(
        cls, edge_configs: list[dict[str, object]]
    ) -> tuple[dict[str, Edge], dict[str, list[str]], dict[str, list[str]]]:
        """
        Build edge objects and mappings from edge configurations.

        :param edge_configs: list of edge configurations
        :return: tuple of (edges dict, in_edges dict, out_edges dict)
        """
        edges: dict[str, Edge] = {}
        in_edges: dict[str, list[str]] = defaultdict(list)
        out_edges: dict[str, list[str]] = defaultdict(list)

        edge_counter = 0
        for edge_config in edge_configs:
            source = edge_config.get("source")
            target = edge_config.get("target")

            if not is_str(source) or not is_str(target):
                continue

            # Create edge
            edge_id = f"edge_{edge_counter}"
            edge_counter += 1

            source_handle = edge_config.get("sourceHandle", "source")
            if not is_str(source_handle):
                continue

            edge = Edge(
                id=edge_id,
                tail=source,
                head=target,
                source_handle=source_handle,
            )

            edges[edge_id] = edge
            out_edges[source].append(edge_id)
            in_edges[target].append(edge_id)

        return edges, dict(in_edges), dict(out_edges)

    @classmethod
    def _create_node_instances(
        cls,
        node_configs_map: dict[str, dict[str, object]],
        node_factory: "NodeFactory",
    ) -> dict[str, Node]:
        """
        Create node instances from configurations using the node factory.

        :param node_configs_map: mapping of node ID to node config
        :param node_factory: factory for creating node instances
        :return: mapping of node ID to node instance
        """
        nodes: dict[str, Node] = {}

        for node_id, node_config in node_configs_map.items():
            try:
                node_instance = node_factory.create_node(node_config)
            except Exception:
                logger.exception("Failed to create node instance for node_id %s", node_id)
                raise
            nodes[node_id] = node_instance

        return nodes

    @classmethod
    def new(cls) -> "GraphBuilder":
        """Create a fluent builder for assembling a graph programmatically."""

        return GraphBuilder(graph_cls=cls)

    @classmethod
    def _promote_fail_branch_nodes(cls, nodes: dict[str, Node]) -> None:
        """
        Promote nodes configured with FAIL_BRANCH error strategy to branch execution type.

        :param nodes: mapping of node ID to node instance
        """
        for node in nodes.values():
            if node.error_strategy == ErrorStrategy.FAIL_BRANCH:
                node.execution_type = NodeExecutionType.BRANCH

    @classmethod
    def _mark_inactive_root_branches(
        cls,
        nodes: dict[str, Node],
        edges: dict[str, Edge],
        in_edges: dict[str, list[str]],
        out_edges: dict[str, list[str]],
        active_root_id: str,
    ) -> None:
        """
        Mark nodes and edges from inactive root branches as skipped.

        Algorithm:
        1. Mark inactive root nodes as skipped
        2. For skipped nodes, mark all their outgoing edges as skipped
        3. For each edge marked as skipped, check its target node:
           - If ALL incoming edges are skipped, mark the node as skipped
           - Otherwise, leave the node state unchanged

        :param nodes: mapping of node ID to node instance
        :param edges: mapping of edge ID to edge instance
        :param in_edges: mapping of node ID to incoming edge IDs
        :param out_edges: mapping of node ID to outgoing edge IDs
        :param active_root_id: ID of the active root node
        """
        # Find all top-level root nodes (nodes with ROOT execution type and no incoming edges)
        top_level_roots: list[str] = [
            node.id for node in nodes.values() if node.execution_type == NodeExecutionType.ROOT
        ]

        # If there's only one root or the active root is not a top-level root, no marking needed
        if len(top_level_roots) <= 1 or active_root_id not in top_level_roots:
            return

        # Mark inactive root nodes as skipped
        inactive_roots: list[str] = [root_id for root_id in top_level_roots if root_id != active_root_id]
        for root_id in inactive_roots:
            if root_id in nodes:
                nodes[root_id].state = NodeState.SKIPPED

        # Recursively mark downstream nodes and edges
        def mark_downstream(node_id: str) -> None:
            """Recursively mark downstream nodes and edges as skipped."""
            if nodes[node_id].state != NodeState.SKIPPED:
                return
            # If this node is skipped, mark all its outgoing edges as skipped
            out_edge_ids = out_edges.get(node_id, [])
            for edge_id in out_edge_ids:
                edge = edges[edge_id]
                edge.state = NodeState.SKIPPED

                # Check the target node of this edge
                target_node = nodes[edge.head]
                in_edge_ids = in_edges.get(target_node.id, [])
                in_edge_states = [edges[eid].state for eid in in_edge_ids]

                # If all incoming edges are skipped, mark the node as skipped
                if all(state == NodeState.SKIPPED for state in in_edge_states):
                    target_node.state = NodeState.SKIPPED
                    # Recursively process downstream nodes
                    mark_downstream(target_node.id)

        # Process each inactive root and its downstream nodes
        for root_id in inactive_roots:
            mark_downstream(root_id)

    @classmethod
    def init(
        cls,
        *,
        graph_config: Mapping[str, object],
        node_factory: "NodeFactory",
        root_node_id: str | None = None,
    ) -> "Graph":
        """
        Initialize graph

        :param graph_config: graph config containing nodes and edges
        :param node_factory: factory for creating node instances from config data
        :param root_node_id: root node id
        :return: graph instance
        """
        # Parse configs
        edge_configs = graph_config.get("edges", [])
        node_configs = graph_config.get("nodes", [])

        edge_configs = cast(list[dict[str, object]], edge_configs)
        node_configs = cast(list[dict[str, object]], node_configs)

        if not node_configs:
            raise ValueError("Graph must have at least one node")

        node_configs = [node_config for node_config in node_configs if node_config.get("type", "") != "custom-note"]

        # Parse node configurations
        node_configs_map = cls._parse_node_configs(node_configs)

        # Find root node
        root_node_id = cls._find_root_node_id(node_configs_map, edge_configs, root_node_id)

        # Build edges
        edges, in_edges, out_edges = cls._build_edges(edge_configs)

        # Create node instances
        nodes = cls._create_node_instances(node_configs_map, node_factory)

        # Promote fail-branch nodes to branch execution type at graph level
        cls._promote_fail_branch_nodes(nodes)

        # Get root node instance
        root_node = nodes[root_node_id]

        # Mark inactive root branches as skipped
        cls._mark_inactive_root_branches(nodes, edges, in_edges, out_edges, root_node_id)

        # Create and return the graph
        graph = cls(
            nodes=nodes,
            edges=edges,
            in_edges=in_edges,
            out_edges=out_edges,
            root_node=root_node,
        )

        # Validate the graph structure using built-in validators
        get_graph_validator().validate(graph)

        return graph

    @property
    def node_ids(self) -> list[str]:
        """
        Get list of node IDs (compatibility property for existing code)

        :return: list of node IDs
        """
        return list(self.nodes.keys())

    def get_outgoing_edges(self, node_id: str) -> list[Edge]:
        """
        Get all outgoing edges from a node (V2 method)

        :param node_id: node id
        :return: list of outgoing edges
        """
        edge_ids = self.out_edges.get(node_id, [])
        return [self.edges[eid] for eid in edge_ids if eid in self.edges]

    def get_incoming_edges(self, node_id: str) -> list[Edge]:
        """
        Get all incoming edges to a node (V2 method)

        :param node_id: node id
        :return: list of incoming edges
        """
        edge_ids = self.in_edges.get(node_id, [])
        return [self.edges[eid] for eid in edge_ids if eid in self.edges]


@final
class GraphBuilder:
    """Fluent helper for constructing simple graphs, primarily for tests."""

    def __init__(self, *, graph_cls: type[Graph]):
        self._graph_cls = graph_cls
        self._nodes: list[Node] = []
        self._nodes_by_id: dict[str, Node] = {}
        self._edges: list[Edge] = []
        self._edge_counter = 0

    def add_root(self, node: Node) -> "GraphBuilder":
        """Register the root node. Must be called exactly once."""

        if self._nodes:
            raise ValueError("Root node has already been added")
        self._register_node(node)
        self._nodes.append(node)
        return self

    def add_node(
        self,
        node: Node,
        *,
        from_node_id: str | None = None,
        source_handle: str = "source",
    ) -> "GraphBuilder":
        """Append a node and connect it from the specified predecessor."""

        if not self._nodes:
            raise ValueError("Root node must be added before adding other nodes")

        predecessor_id = from_node_id or self._nodes[-1].id
        if predecessor_id not in self._nodes_by_id:
            raise ValueError(f"Predecessor node '{predecessor_id}' not found")

        predecessor = self._nodes_by_id[predecessor_id]
        self._register_node(node)
        self._nodes.append(node)

        edge_id = f"edge_{self._edge_counter}"
        self._edge_counter += 1
        edge = Edge(id=edge_id, tail=predecessor.id, head=node.id, source_handle=source_handle)
        self._edges.append(edge)

        return self

    def connect(self, *, tail: str, head: str, source_handle: str = "source") -> "GraphBuilder":
        """Connect two existing nodes without adding a new node."""

        if tail not in self._nodes_by_id:
            raise ValueError(f"Tail node '{tail}' not found")
        if head not in self._nodes_by_id:
            raise ValueError(f"Head node '{head}' not found")

        edge_id = f"edge_{self._edge_counter}"
        self._edge_counter += 1
        edge = Edge(id=edge_id, tail=tail, head=head, source_handle=source_handle)
        self._edges.append(edge)

        return self

    def build(self) -> Graph:
        """Materialize the graph instance from the accumulated nodes and edges."""

        if not self._nodes:
            raise ValueError("Cannot build an empty graph")

        nodes = {node.id: node for node in self._nodes}
        edges = {edge.id: edge for edge in self._edges}
        in_edges: dict[str, list[str]] = defaultdict(list)
        out_edges: dict[str, list[str]] = defaultdict(list)

        for edge in self._edges:
            out_edges[edge.tail].append(edge.id)
            in_edges[edge.head].append(edge.id)

        return self._graph_cls(
            nodes=nodes,
            edges=edges,
            in_edges=dict(in_edges),
            out_edges=dict(out_edges),
            root_node=self._nodes[0],
        )

    def _register_node(self, node: Node) -> None:
        if not node.id:
            raise ValueError("Node must have a non-empty id")
        if node.id in self._nodes_by_id:
            raise ValueError(f"Duplicate node id detected: {node.id}")
        self._nodes_by_id[node.id] = node
