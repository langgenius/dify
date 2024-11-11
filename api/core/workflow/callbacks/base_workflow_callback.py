from abc import ABC, abstractmethod

from core.workflow.graph_engine.entities.event import GraphEngineEvent


class WorkflowCallback(ABC):
    @abstractmethod
    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Published event
        """
        raise NotImplementedError
