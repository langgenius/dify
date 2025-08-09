from abc import ABC, abstractmethod

from core.workflow.events import GraphEngineEvent


class WorkflowCallback(ABC):
    @abstractmethod
    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Published event
        """
        raise NotImplementedError
