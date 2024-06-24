from abc import ABC, abstractmethod

from core.ops.entities.trace_entity import BaseTraceInfo


class BaseTraceInstance(ABC):
    """
    Base trace instance for ops trace services
    """

    @abstractmethod
    def __init__(self):
        """
        Abstract initializer for the trace instance.
        Distribute trace tasks by matching entities
        """
        ...

    @abstractmethod
    def trace(self, trace_info: BaseTraceInfo):
        """
        Abstract method to trace activities.
        Subclasses must implement specific tracing logic for activities.
        """
        ...
