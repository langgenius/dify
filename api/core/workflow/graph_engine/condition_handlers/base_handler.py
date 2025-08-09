from abc import ABC, abstractmethod

from core.workflow.entities import GraphInitParams, GraphRuntimeState, RouteNodeState, RunCondition
from core.workflow.graph import Graph


class RunConditionHandler(ABC):
    def __init__(self, init_params: GraphInitParams, graph: Graph, condition: RunCondition):
        self.init_params = init_params
        self.graph = graph
        self.condition = condition

    @abstractmethod
    def check(self, graph_runtime_state: GraphRuntimeState, previous_route_node_state: RouteNodeState) -> bool:
        """
        Check if the condition can be executed

        :param graph_runtime_state: graph runtime state
        :param previous_route_node_state: previous route node state
        :return: bool
        """
        raise NotImplementedError
