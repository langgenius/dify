from abc import ABC, abstractmethod

from core.workflow.graph_engine.entities.event import GraphEngineEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState


class WorkflowCallback(ABC):
    @abstractmethod
    def on_event(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: GraphEngineEvent
    ) -> None:
        """
        Published event
        """
        raise NotImplementedError
