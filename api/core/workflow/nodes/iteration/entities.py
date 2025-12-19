from enum import StrEnum
from typing import Any

from pydantic import Field

from core.workflow.nodes.base import BaseIterationNodeData, BaseIterationState, BaseNodeData


class ErrorHandleMode(StrEnum):
    TERMINATED = "terminated"
    CONTINUE_ON_ERROR = "continue-on-error"
    REMOVE_ABNORMAL_OUTPUT = "remove-abnormal-output"


class IterationNodeData(BaseIterationNodeData):
    """
    Iteration Node Data.
    """

    parent_loop_id: str | None = None  # redundant field, not used currently
    iterator_selector: list[str]  # variable selector
    output_selector: list[str]  # output selector
    is_parallel: bool = False  # open the parallel mode or not
    parallel_nums: int = 10  # the numbers of parallel
    error_handle_mode: ErrorHandleMode = ErrorHandleMode.TERMINATED  # how to handle the error
    flatten_output: bool = True  # whether to flatten the output array if all elements are lists


class IterationStartNodeData(BaseNodeData):
    """
    Iteration Start Node Data.
    """

    pass


class IterationState(BaseIterationState):
    """
    Iteration State.
    """

    outputs: list[Any] = Field(default_factory=list)
    current_output: Any = None

    class MetaData(BaseIterationState.MetaData):
        """
        Data.
        """

        iterator_length: int

    def get_last_output(self) -> Any:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None

    def get_current_output(self) -> Any:
        """
        Get current output.
        """
        return self.current_output
