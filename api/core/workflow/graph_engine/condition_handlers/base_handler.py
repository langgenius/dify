from abc import ABC, abstractmethod

from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.run_condition import RunCondition
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState


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
