from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData

from .enums import InputType, Operation


class VariableOperationItem(BaseModel):
    variable_selector: Sequence[str]
    input_type: InputType
    operation: Operation
    # NOTE(QuantumGhost): The `value` field serves multiple purposes depending on context:
    #
    # 1. For CONSTANT input_type: Contains the literal value to be used in the operation.
    # 2. For VARIABLE input_type: Initially contains the selector of the source variable.
    # 3. During the variable updating procedure: The `value` field is reassigned to hold
    #    the resolved actual value that will be applied to the target variable.
    value: Any = None


class VariableAssignerNodeData(BaseNodeData):
    version: str = "2"
    items: Sequence[VariableOperationItem] = Field(default_factory=list)
