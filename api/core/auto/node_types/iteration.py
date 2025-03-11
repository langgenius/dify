from enum import Enum
from typing import Optional

from .common import BlockEnum, CommonNodeType, ValueSelector, VarType


class ErrorHandleMode(str, Enum):
    """Error handling modes for iteration."""

    terminated = "terminated"
    continue_on_error = "continue-on-error"
    remove_abnormal_output = "remove-abnormal-output"


class IterationNodeType(CommonNodeType):
    """Iteration node type implementation."""

    startNodeType: Optional[BlockEnum] = None
    start_node_id: str  # Start node ID in the iteration
    iteration_id: Optional[str] = None
    iterator_selector: ValueSelector
    output_selector: ValueSelector
    output_type: VarType  # Output type
    is_parallel: bool  # Open the parallel mode or not
    parallel_nums: int  # The numbers of parallel
    error_handle_mode: ErrorHandleMode  # How to handle error in the iteration
    _isShowTips: bool  # Show tips when answer node in parallel mode iteration


# 示例用法
if __name__ == "__main__":
    example_node = IterationNodeType(
        title="Example Iteration Node",
        desc="An iteration node example",
        type=BlockEnum.iteration,
        start_node_id="startNode1",
        iterator_selector=ValueSelector(value=["iteratorNode", "value"]),
        output_selector=ValueSelector(value=["outputNode", "value"]),
        output_type=VarType.string,
        is_parallel=True,
        parallel_nums=5,
        error_handle_mode=ErrorHandleMode.continue_on_error,
        _isShowTips=True,
    )
    print(example_node)
