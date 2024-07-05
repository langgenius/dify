from typing import Optional, cast

from pydantic import BaseModel, Field

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.run_condition import RunCondition


class GraphEdge(BaseModel):
    source_node_id: str
    """source node id"""

    target_node_id: str
    """target node id"""

    run_condition: Optional[RunCondition] = None
    """condition to run the edge"""


class GraphStateRoute(BaseModel):
    route_id: str
    """route id"""

    node_id: str
    """node id"""


class GraphState(BaseModel):
    routes: dict[str, list[GraphStateRoute]] = Field(default_factory=dict)
    """graph state routes (route_id: run_result)"""

    variable_pool: VariablePool
    """variable pool"""

    node_route_results: dict[str, NodeRunResult] = Field(default_factory=dict)
    """node results in route (route_id: run_result)"""


class Graph(BaseModel):
    root_node_id: str
    """root node id of the graph"""

    node_ids: list[str] = Field(default_factory=list)
    """graph node ids"""

    edge_mapping: dict[str, list[GraphEdge]] = Field(default_factory=dict)
    """graph edge mapping"""

    run_state: GraphState
    """graph run state"""

    @classmethod
    def init(cls,
             graph_config: dict,
             variable_pool: VariablePool,
             root_node_id: Optional[str] = None) -> "Graph":
        """
        Init graph

        :param graph_config: graph config
        :param variable_pool: variable pool
        :param root_node_id: root node id
        :return: graph
        """
        # edge configs
        edge_configs = graph_config.get('edges')
        if edge_configs is None:
            edge_configs = []

        edge_configs = cast(list, edge_configs)

        # reorganize edges mapping
        edge_mapping: dict[str, list[GraphEdge]] = {}
        target_edge_ids = set()
        for edge_config in edge_configs:
            source_node_id = edge_config.get('source')
            if not source_node_id:
                continue

            if source_node_id not in edge_mapping:
                edge_mapping[source_node_id] = []

            target_node_id = edge_config.get('target')
            if not target_node_id:
                continue

            target_edge_ids.add(target_node_id)

            # parse run condition
            run_condition = None
            if edge_config.get('sourceHandle'):
                run_condition = RunCondition(
                    type='branch_identify',
                    branch_identify=edge_config.get('sourceHandle')
                )

            graph_edge = GraphEdge(
                source_node_id=source_node_id,
                target_node_id=edge_config.get('target'),
                run_condition=run_condition
            )

            edge_mapping[source_node_id].append(graph_edge)

        # node configs
        node_configs = graph_config.get('nodes')
        if not node_configs:
            raise ValueError("Graph must have at least one node")

        node_configs = cast(list, node_configs)

        # fetch nodes that have no predecessor node
        root_node_configs = []
        for node_config in node_configs:
            node_id = node_config.get('id')
            if not node_id:
                continue

            if node_id not in target_edge_ids:
                root_node_configs.append(node_config)

        root_node_ids = [node_config.get('id') for node_config in root_node_configs]

        # fetch root node
        if not root_node_id:
            # if no root node id, use the START type node as root node
            root_node_id = next((node_config for node_config in root_node_configs
                                 if node_config.get('data', {}).get('type', '') == NodeType.START.value), None)

        if not root_node_id or root_node_id not in root_node_ids:
            raise ValueError(f"Root node id {root_node_id} not found in the graph")

        # fetch all node ids from root node
        node_ids = [root_node_id]
        cls._recursively_add_node_ids(
            node_ids=node_ids,
            edge_mapping=edge_mapping,
            node_id=root_node_id
        )

        # init graph
        graph = cls(
            root_node_id=root_node_id,
            node_ids=node_ids,
            edge_mapping=edge_mapping,
            run_state=GraphState(
                variable_pool=variable_pool
            )
        )

        return graph

    @classmethod
    def _recursively_add_node_ids(cls,
                                  node_ids: list[str],
                                  edge_mapping: dict[str, list[GraphEdge]],
                                  node_id: str) -> None:
        """
        Recursively add node ids

        :param node_ids: node ids
        :param edge_mapping: edge mapping
        :param node_id: node id
        """
        for graph_edge in edge_mapping.get(node_id, []):
            if graph_edge.target_node_id in node_ids:
                continue

            node_ids.append(graph_edge.target_node_id)
            cls._recursively_add_node_ids(
                node_ids=node_ids,
                edge_mapping=edge_mapping,
                node_id=graph_edge.target_node_id
            )
    def next_node_ids(self) -> list[str]:
        """
        Get next node ids
        """
        # todo
        return []

    def add_extra_edge(self, source_node_id: str,
                       target_node_id: str,
                       run_condition: Optional[RunCondition] = None) -> None:
        """
        Add extra edge to the graph

        :param source_node_id: source node id
        :param target_node_id: target node id
        :param run_condition: run condition
        """
        if source_node_id not in self.node_ids or target_node_id not in self.node_ids:
            return

        if source_node_id not in self.edge_mapping:
            self.edge_mapping[source_node_id] = []

        if target_node_id in [graph_edge.target_node_id for graph_edge in self.edge_mapping[source_node_id]]:
            return

        graph_edge = GraphEdge(
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            run_condition=run_condition
        )

        self.edge_mapping[source_node_id].append(graph_edge)

    def get_leaf_node_ids(self) -> list[str]:
        """
        Get leaf node ids of the graph

        :return: leaf node ids
        """
        leaf_node_ids = []
        for node_id in self.node_ids:
            if node_id not in self.edge_mapping:
                leaf_node_ids.append(node_id)
            elif (len(self.edge_mapping[node_id]) == 1
                  and self.edge_mapping[node_id][0].target_node_id == self.root_node_id):
                leaf_node_ids.append(node_id)

        return leaf_node_ids
