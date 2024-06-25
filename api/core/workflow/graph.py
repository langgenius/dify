from collections.abc import Callable
from typing import Optional

from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    """node id"""

    predecessor_node_id: Optional[str] = None
    """predecessor node id"""

    children_node_ids: list[str] = []
    """children node ids"""

    source_handle: Optional[str] = None
    """current node source handle from the previous node result"""

    run_condition_callback: Optional[Callable] = None
    """condition function check if the node can be executed"""

    node_config: dict
    """original node config"""

    source_edge_config: Optional[dict] = None
    """original source edge config"""

    target_edge_config: Optional[dict] = None
    """original target edge config"""

    def add_child(self, node_id: str) -> None:
        self.children_node_ids.append(node_id)


class Graph(BaseModel):
    graph_config: dict
    """graph config from workflow"""

    graph_nodes: dict[str, GraphNode] = {}
    """graph nodes"""

    root_node: Optional[GraphNode] = None
    """root node of the graph"""

    def add_edge(self, edge_config: dict,
                 source_node_config: dict,
                 target_node_config: dict,
                 run_condition_callback: Optional[Callable] = None) -> None:
        """
        Add edge to the graph

        :param edge_config: edge config
        :param source_node_config: source node config
        :param target_node_config: target node config
        :param run_condition_callback: condition callback
        """
        source_node_id = source_node_config.get('id')
        if not source_node_id:
            return

        target_node_id = target_node_config.get('id')
        if not target_node_id:
            return

        if source_node_id not in self.graph_nodes:
            source_graph_node = GraphNode(
                id=source_node_id,
                node_config=source_node_config,
                children_node_ids=[target_node_id],
                target_edge_config=edge_config,
            )

            self.add_graph_node(source_graph_node)
        else:
            source_node = self.graph_nodes[source_node_id]
            source_node.add_child(target_node_id)
            source_node.target_edge_config = edge_config

        if target_node_id not in self.graph_nodes:
            target_graph_node = GraphNode(
                id=target_node_id,
                predecessor_node_id=source_node_id,
                node_config=target_node_config,
                run_condition_callback=run_condition_callback,
                source_edge_config=edge_config,
            )

            self.add_graph_node(target_graph_node)
        else:
            target_node = self.graph_nodes[target_node_id]
            target_node.predecessor_node_id = source_node_id
            target_node.run_condition_callback = run_condition_callback
            target_node.source_edge_config = edge_config

    def add_graph_node(self, graph_node: GraphNode) -> None:
        """
        Add graph node to the graph

        :param graph_node: graph node
        """
        if graph_node.id in self.graph_nodes:
            return

        if len(self.graph_nodes) == 0:
            self.root_node = graph_node

        self.graph_nodes[graph_node.id] = graph_node

    def get_root_node(self) -> Optional[GraphNode]:
        """
        Get root node of the graph

        :return: root node
        """
        return self.root_node

    def get_descendants_graph(self, node_id: str) -> Optional["Graph"]:
        """
        Get descendants graph of the specific node

        :param node_id: node id
        :return: descendants graph
        """
        if node_id not in self.graph_nodes:
            return None

        graph_node = self.graph_nodes[node_id]
        if not graph_node.children_node_ids:
            return None

        descendants_graph = Graph(graph_config=self.graph_config)
        descendants_graph.add_graph_node(graph_node)

        for child_node_id in graph_node.children_node_ids:
            self._add_descendants_graph_nodes(descendants_graph, child_node_id)

        return descendants_graph

    def _add_descendants_graph_nodes(self, descendants_graph: "Graph", node_id: str) -> None:
        """
        Add descendants graph nodes

        :param descendants_graph: descendants graph
        :param node_id: node id
        """
        if node_id not in self.graph_nodes:
            return

        graph_node = self.graph_nodes[node_id]
        descendants_graph.add_graph_node(graph_node)

        for child_node_id in graph_node.children_node_ids:
            self._add_descendants_graph_nodes(descendants_graph, child_node_id)
