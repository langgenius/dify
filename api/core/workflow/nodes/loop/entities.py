from collections.abc import Mapping
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseLoopNodeData, BaseLoopState, BaseNodeData
from core.workflow.utils.condition.entities import Condition


class LoopVariableData(BaseModel):
    """
    Loop Variable Data.
    """

    label: str
    var_type: Literal["string", "number", "object", "array[string]", "array[number]", "array[object]"]
    value_type: Literal["variable", "constant"]
    value: Optional[Any | list[str]] = None


class LoopNodeData(BaseLoopNodeData):
    """
    Loop Node Data.
    """

    loop_count: int  # Maximum number of loops
    break_conditions: list[Condition]  # Conditions to break the loop
    logical_operator: Literal["and", "or"]
    loop_variables: Optional[list[LoopVariableData]] = Field(default_factory=list)
    outputs: Optional[Mapping[str, Any]] = None


class LoopStartNodeData(BaseNodeData):
    """
    Loop Start Node Data.
    """

    pass


class LoopEndNodeData(BaseNodeData):
    """
    Loop End Node Data.
    """

    pass


class LoopState(BaseLoopState):
    """
    Loop State.
    """

    outputs: list[Any] = Field(default_factory=list)
    current_output: Optional[Any] = None

    class MetaData(BaseLoopState.MetaData):
        """
        Data.
        """

        loop_length: int

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
