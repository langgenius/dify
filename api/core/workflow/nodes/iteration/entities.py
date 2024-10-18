from enum import Enum
from typing import Any, Optional

from core.workflow.entities.base_node_data_entities import BaseIterationNodeData, BaseIterationState, BaseNodeData


class ErrorHandleMode(Enum):
    TERMINATED = "Terminated"
    CONTINUE_ON_ERROR = "Continue on error"
    REMOVE_ABNORMAL_OUTPUT = "Remove abnormal output"

    def to_json(self):
        return self.value

    @classmethod
    def from_json(cls, value):
        return cls(value)


class IterationNodeData(BaseIterationNodeData):
    """
    Iteration Node Data.
    """

    parent_loop_id: Optional[str] = None  # redundant field, not used currently
    iterator_selector: list[str]  # variable selector
    output_selector: list[str]  # output selector
    is_parallel: bool = False  # open the parallel mode or not
    parallel_nums: int = 10  # the numbers of parallel
    error_handle_mode: ErrorHandleMode = ErrorHandleMode.TERMINATED  # how to handle the error


class IterationStartNodeData(BaseNodeData):
    """
    Iteration Start Node Data.
    """

    pass


class IterationState(BaseIterationState):
    """
    Iteration State.
    """

    outputs: list[Any] = None
    current_output: Optional[Any] = None

    class MetaData(BaseIterationState.MetaData):
        """
        Data.
        """

        iterator_length: int

    def get_last_output(self) -> Optional[Any]:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None

    def get_current_output(self) -> Optional[Any]:
        """
        Get current output.
        """
        return self.current_output
