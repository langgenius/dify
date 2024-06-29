from collections.abc import Callable
from typing import Literal, Optional

from pydantic import BaseModel, Field

from core.workflow.utils.condition.entities import Condition


class RunCondition(BaseModel):
    type: Literal["branch_identify", "condition"]
    """condition type"""

    branch_identify: Optional[str] = None
    """branch identify, required when type is branch_identify"""

    conditions: Optional[list[Condition]] = None
    """conditions to run the node, required when type is condition"""


class GraphNode(BaseModel):
    id: str
    """node id"""

    parent_id: Optional[str] = None
    """parent node id, e.g. iteration/loop"""

    predecessor_node_id: Optional[str] = None
    """predecessor node id"""

    descendant_node_ids: list[str] = []
    """descendant node ids"""

    run_condition: Optional[RunCondition] = None
    """condition to run the node"""

    run_condition_callback: Optional[Callable] = Field(None, exclude=True)
    """condition function check if the node can be executed, translated from run_conditions, not serialized"""

    node_config: dict
    """original node config"""

    source_edge_config: Optional[dict] = None
    """original source edge config"""

    sub_graph: Optional["Graph"] = None
    """sub graph of the node, e.g. iteration/loop sub graph"""

    def add_child(self, node_id: str) -> None:
        self.descendant_node_ids.append(node_id)


class Graph(BaseModel):
    graph_nodes: dict[str, GraphNode] = {}
    """graph nodes"""

    root_node: GraphNode
    """root node of the graph"""

    @classmethod
    def init(cls, root_node_config: dict, run_condition: Optional[RunCondition] = None) -> "Graph":
        """
        Init graph

        :param root_node_config: root node config
        :param run_condition: run condition when root node parent is iteration/loop
        :return: graph
        """
        root_node = GraphNode(
            id=root_node_config.get('id'),
            parent_id=root_node_config.get('parentId'),
            node_config=root_node_config,
            run_condition=run_condition
        )

        graph = cls(root_node=root_node)

        # TODO parse run_condition to run_condition_callback

        graph.add_graph_node(graph.root_node)
        return graph

    def add_edge(self, edge_config: dict,
                 source_node_config: dict,
                 target_node_config: dict,
                 target_node_sub_graph: Optional["Graph"] = None) -> None:
        """
        Add edge to the graph

        :param edge_config: edge config
        :param source_node_config: source node config
        :param target_node_config: target node config
        :param target_node_sub_graph: sub graph
        """
        source_node_id = source_node_config.get('id')
        if not source_node_id:
            return

        if source_node_id not in self.graph_nodes:
            return

        target_node_id = target_node_config.get('id')
        if not target_node_id:
            return

        source_node = self.graph_nodes[source_node_id]
        source_node.add_child(target_node_id)

        # if run_conditions:
        #     run_condition_callback = lambda: all()


        if target_node_id not in self.graph_nodes:
            run_condition = None # todo
            run_condition_callback = None # todo

            target_graph_node = GraphNode(
                id=target_node_id,
                parent_id=source_node_config.get('parentId'),
                predecessor_node_id=source_node_id,
                node_config=target_node_config,
                run_condition=run_condition,
                run_condition_callback=run_condition_callback,
                source_edge_config=edge_config,
                sub_graph=target_node_sub_graph
            )

            self.add_graph_node(target_graph_node)
        else:
            target_node = self.graph_nodes[target_node_id]
            target_node.predecessor_node_id = source_node_id
            target_node.run_conditions = run_conditions
            target_node.run_condition_callback = run_condition_callback
            target_node.source_edge_config = edge_config
            target_node.sub_graph = target_node_sub_graph

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
        if not graph_node.descendant_node_ids:
            return None

        descendants_graph = Graph()
        descendants_graph.add_graph_node(graph_node)

        for child_node_id in graph_node.descendant_node_ids:
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

        for child_node_id in graph_node.descendant_node_ids:
            self._add_descendants_graph_nodes(descendants_graph, child_node_id)
