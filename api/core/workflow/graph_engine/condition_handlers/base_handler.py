from abc import ABC, abstractmethod

from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.run_condition import RunCondition


class RunConditionHandler(ABC):
    def __init__(self,
                 init_params: GraphInitParams,
                 graph: Graph,
                 condition: RunCondition):
        self.init_params = init_params
        self.graph = graph
        self.condition = condition

    @abstractmethod
    def check(self,
              graph_runtime_state: GraphRuntimeState,
              source_node_id: str,
              target_node_id: str) -> bool:
        """
        Check if the condition can be executed

        :param graph_runtime_state: graph runtime state
        :param source_node_id: source node id
        :param target_node_id: target node id
        :return: bool
        """
        raise NotImplementedError
