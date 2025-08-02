from collections import defaultdict
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Optional, cast

from core.workflow.enums import NodeType

from .edge import Edge
from .node import Node

if TYPE_CHECKING:
    from core.workflow.nodes.node_factory import NodeFactory


class Graph:
    """Graph representation with nodes and edges for workflow execution."""

    def __init__(
        self,
        nodes: Optional[dict[str, Node]] = None,
        edges: Optional[dict[str, Edge]] = None,
        in_edges: Optional[dict[str, list[str]]] = None,
        out_edges: Optional[dict[str, list[str]]] = None,
        root_node: Optional[Node] = None,
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
        :param graph_init_params: graph initialization parameters
        :param graph_runtime_state: graph runtime state
        :param node_factory: factory for creating node instances from config data
        :param root_node_id: root node id
        :return: graph instance with V2 attributes populated
        """
        # Parse configs
        edge_configs = graph_config.get("edges", [])
        node_configs = graph_config.get("nodes", [])

        if not node_configs:
            raise ValueError("Graph must have at least one node")

        edge_configs = cast(list, edge_configs)
        node_configs = cast(list, node_configs)

        # Initialize V2 data structures
        nodes: dict[str, Node] = {}
        edges: dict[str, Edge] = {}
        in_edges: dict[str, list[str]] = defaultdict(list)
        out_edges: dict[str, list[str]] = defaultdict(list)

        # Build node mapping - first pass: collect node configs
        node_configs_map: dict[str, dict[str, Any]] = {}

        for node_config in node_configs:
            node_id = node_config.get("id")
            if not node_id:
                continue

            node_configs_map[node_id] = node_config

        # Find root node if not specified
        if not root_node_id:
            # Find nodes with no incoming edges first
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

        if not root_node_id or root_node_id not in node_configs_map:
            raise ValueError(f"Root node id {root_node_id} not found in the graph")

        # Build edges
        edge_counter = 0
        for edge_config in edge_configs:
            source = edge_config.get("source")
            target = edge_config.get("target")

            if not source or not target:
                continue

            # Create edge
            edge_id = f"edge_{edge_counter}"
            edge_counter += 1

            # Parse run condition (simplified for V2)
            run_condition = None
            if edge_config.get("sourceHandle") and edge_config.get("sourceHandle") != "source":
                from core.workflow.entities.run_condition import RunCondition

                run_condition = RunCondition(type="branch_identify", branch_identify=edge_config.get("sourceHandle"))

            edge = Edge(
                id=edge_id,
                tail=source,
                head=target,
            )

            edges[edge_id] = edge
            out_edges[source].append(edge_id)
            in_edges[target].append(edge_id)

        # Create Node instances
        for node_id, node_config in node_configs_map.items():
            node_instance = node_factory.create_node(node_config)
            nodes[node_id] = node_instance

        # Get root node instance
        root_node = nodes[root_node_id]

        # Create and return the graph
        return cls(
            nodes=nodes,
            edges=edges,
            in_edges=dict(in_edges),
            out_edges=dict(out_edges),
            root_node=root_node,
        )

    @property
    def node_ids(self) -> list[str]:
        """
        Get list of node IDs (compatibility property for existing code)

        :return: list of node IDs
        """
        return list(self.nodes.keys())

    def get_node(self, node_id: str) -> Optional[Node]:
        """
        Get node by ID (V2 method)

        :param node_id: node id
        :return: node object or None
        """
        return self.nodes.get(node_id)

    def get_edge(self, edge_id: str) -> Optional[Edge]:
        """
        Get edge by ID (V2 method)

        :param edge_id: edge id
        :return: edge object or None
        """
        return self.edges.get(edge_id)

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
