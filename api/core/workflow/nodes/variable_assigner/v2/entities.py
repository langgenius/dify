from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel

from core.workflow.nodes.base import BaseNodeData

from .enums import InputType, Operation


class VariableOperationItem(BaseModel):
    variable_selector: Sequence[str]
    input_type: InputType
    operation: Operation
    value: Any | None = None


class VariableAssignerNodeData(BaseNodeData):
    version: str = "2"
    items: Sequence[VariableOperationItem]
