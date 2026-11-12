from pydantic import Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, ErrorHandleMode, NodeType


class IterationNodeData(BaseNodeData):
    """Iteration Node Data."""

    type: NodeType = BuiltinNodeTypes.ITERATION
    start_node_id: str
    iterator_selector: list[str]  # variable selector
    output_selector: list[str]  # output selector
    is_parallel: bool = False  # open the parallel mode or not
    parallel_nums: int = Field(default=10, ge=1)  # the numbers of parallel
    error_handle_mode: ErrorHandleMode = (
        ErrorHandleMode.TERMINATED
    )  # how to handle the error
    flatten_output: bool = (
        True  # whether to flatten the output array if all elements are lists
    )


class IterationStartNodeData(BaseNodeData):
    """Iteration Start Node Data."""

    type: NodeType = BuiltinNodeTypes.ITERATION_START
