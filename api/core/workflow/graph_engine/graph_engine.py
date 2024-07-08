import time
from collections.abc import Generator
from typing import cast

from flask import current_app

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.base_node import UserFrom


class GraphEngine:
    def __init__(self, tenant_id: str,
                 app_id: str,
                 user_id: str,
                 user_from: UserFrom,
                 invoke_from: InvokeFrom,
                 call_depth: int,
                 graph: Graph,
                 variable_pool: VariablePool,
                 callbacks: list[BaseWorkflowCallback]) -> None:
        self.graph = graph
        self.graph_runtime_state = GraphRuntimeState(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            variable_pool=variable_pool
        )

        max_execution_steps = current_app.config.get("WORKFLOW_MAX_EXECUTION_STEPS")
        self.max_execution_steps = cast(int, max_execution_steps)
        max_execution_time = current_app.config.get("WORKFLOW_MAX_EXECUTION_TIME")
        self.max_execution_time = cast(int, max_execution_time)

        self.callbacks = callbacks

    def run(self) -> Generator:
        self.graph_runtime_state.start_at = time.perf_counter()
        pass

    # def next_node_ids(self, node_state_id: str) -> list[NextGraphNode]:
    #     """
    #     Get next node ids
    #
    #     :param node_state_id: source node state id
    #     """
    #     # get current node ids in state
    #     node_run_state = self.graph_runtime_state.node_run_state
    #     graph = self.graph
    #     if not node_run_state.routes:
    #         return [NextGraphNode(node_id=graph.root_node_id)]
    #
    #     route_final_graph_edges: list[GraphEdge] = []
    #     for route in route_state.routes[graph.root_node_id]:
    #         graph_edges = graph.edge_mapping.get(route.node_id)
    #         if not graph_edges:
    #             continue
    #
    #         for edge in graph_edges:
    #             if edge.target_node_id not in route_state.routes:
    #                 route_final_graph_edges.append(edge)
    #
    #     next_graph_nodes = []
    #     for route_final_graph_edge in route_final_graph_edges:
    #         node_id = route_final_graph_edge.target_node_id
    #         # check condition
    #         if route_final_graph_edge.run_condition:
    #             result = ConditionManager.get_condition_handler(
    #                 run_condition=route_final_graph_edge.run_condition
    #             ).check(
    #                 source_node_id=route_final_graph_edge.source_node_id,
    #                 target_node_id=route_final_graph_edge.target_node_id,
    #                 graph=self
    #             )
    #
    #             if not result:
    #                 continue
    #
    #         parallel = None
    #         if route_final_graph_edge.target_node_id in graph.node_parallel_mapping:
    #             parallel = graph.parallel_mapping[graph.node_parallel_mapping[node_id]]
    #
    #         next_graph_nodes.append(NextGraphNode(node_id=node_id, parallel=parallel))
    #
    #     return next_graph_nodes
