from collections.abc import Sequence
from typing import Any

from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError

from .enums import InputType, Operation


class OperationNotSupportedError(VariableOperatorNodeError):
    def __init__(self, *, operation: Operation, varialbe_type: str):
        super().__init__(f"Operation {operation} is not supported for type {varialbe_type}")


class InputTypeNotSupportedError(VariableOperatorNodeError):
    def __init__(self, *, input_type: InputType, operation: Operation):
        super().__init__(f"Input type {input_type} is not supported for operation {operation}")


class VariableNotFoundError(VariableOperatorNodeError):
    def __init__(self, *, variable_selector: Sequence[str]):
        super().__init__(f"Variable {variable_selector} not found")


class InvalidInputValueError(VariableOperatorNodeError):
    def __init__(self, *, value: Any):
        super().__init__(f"Invalid input value {value}")


class ConversationIDNotFoundError(VariableOperatorNodeError):
    def __init__(self):
        super().__init__("conversation_id not found")
