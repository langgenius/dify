import logging
from collections import defaultdict
from collections.abc import Mapping
from typing import Any, Optional, Protocol, cast

from core.workflow.enums import NodeType

from .edge import Edge
from .node import Node

logger = logging.getLogger(__name__)


class NodeFactory(Protocol):
    """
    Protocol for creating Node instances from node data dictionaries.

    This protocol decouples the Graph class from specific node mapping implementations,
    allowing for different node creation strategies while maintaining type safety.
    """

    def create_node(self, node_config: dict[str, Any]) -> Node:
        """
        Create a Node instance from node configuration data.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node type is unknown or configuration is invalid
        """
        ...


class Graph:
    """Graph representation with nodes and edges for workflow execution."""

    def __init__(
        self,
        *,
        nodes: Optional[dict[str, Node]] = None,
        edges: Optional[dict[str, Edge]] = None,
        in_edges: Optional[dict[str, list[str]]] = None,
        out_edges: Optional[dict[str, list[str]]] = None,
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
    def _parse_node_configs(cls, node_configs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """
        Parse node configurations and build a mapping of node IDs to configs.

        :param node_configs: list of node configuration dictionaries
        :return: mapping of node ID to node config
        """
        node_configs_map: dict[str, dict[str, Any]] = {}

        for node_config in node_configs:
            node_id = node_config.get("id")
            if not node_id:
                continue

            node_configs_map[node_id] = node_config

        return node_configs_map

    @classmethod
    def _find_root_node_id(
        cls,
        node_configs_map: dict[str, dict[str, Any]],
        edge_configs: list[dict[str, Any]],
        root_node_id: Optional[str] = None,
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
        nodes_with_incoming = set()
        for edge_config in edge_configs:
            target = edge_config.get("target")
            if target:
                nodes_with_incoming.add(target)

        root_candidates = [nid for nid in node_configs_map if nid not in nodes_with_incoming]

        # Prefer START node if available
        start_node_id = None
        for nid in root_candidates:
            node_data = node_configs_map[nid].get("data", {})
            if node_data.get("type") == NodeType.START.value:
                start_node_id = nid
                break

        root_node_id = start_node_id or (root_candidates[0] if root_candidates else None)

        if not root_node_id:
            raise ValueError("Unable to determine root node ID")

        return root_node_id

    @classmethod
    def _build_edges(
        cls, edge_configs: list[dict[str, Any]]
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

            if not source or not target:
                continue

            # Create edge
            edge_id = f"edge_{edge_counter}"
            edge_counter += 1

            source_handle = edge_config.get("sourceHandle", "source")

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
        node_configs_map: dict[str, dict[str, Any]],
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
            except ValueError as e:
                logger.warning("Failed to create node instance: %s", str(e))
                continue
            nodes[node_id] = node_instance

        return nodes

    @classmethod
    def init(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_factory: "NodeFactory",
        root_node_id: Optional[str] = None,
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

        if not node_configs:
            raise ValueError("Graph must have at least one node")

        edge_configs = cast(list, edge_configs)
        node_configs = [node_config for node_config in node_configs if node_config.get("type", "") != "custom-note"]

        # Parse node configurations
        node_configs_map = cls._parse_node_configs(node_configs)

        # Find root node
        root_node_id = cls._find_root_node_id(node_configs_map, edge_configs, root_node_id)

        # Build edges
        edges, in_edges, out_edges = cls._build_edges(edge_configs)

        # Create node instances
        nodes = cls._create_node_instances(node_configs_map, node_factory)

        # Get root node instance
        root_node = nodes[root_node_id]

        # Create and return the graph
        return cls(
            nodes=nodes,
            edges=edges,
            in_edges=in_edges,
            out_edges=out_edges,
            root_node=root_node,
        )

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
