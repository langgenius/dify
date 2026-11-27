from collections.abc import Sequence
from typing import Any

from graphon.nodes.variable_assigner.common.exc import VariableOperatorNodeError

from .enums import InputType, Operation


class OperationNotSupportedError(VariableOperatorNodeError):
    def __init__(self, *, operation: Operation, variable_type: str) -> None:
        super().__init__(
            f"Operation {operation} is not supported for type {variable_type}",
        )


class InputTypeNotSupportedError(VariableOperatorNodeError):
    def __init__(self, *, input_type: InputType, operation: Operation) -> None:
        super().__init__(
            f"Input type {input_type} is not supported for operation {operation}",
        )


class VariableNotFoundError(VariableOperatorNodeError):
    def __init__(self, *, variable_selector: Sequence[str]) -> None:
        super().__init__(f"Variable {variable_selector} not found")


class InvalidInputValueError(VariableOperatorNodeError):
    def __init__(self, *, value: Any) -> None:
        super().__init__(f"Invalid input value {value}")


class ConversationIDNotFoundError(VariableOperatorNodeError):
    def __init__(self) -> None:
        super().__init__("conversation_id not found")


class InvalidDataError(VariableOperatorNodeError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
