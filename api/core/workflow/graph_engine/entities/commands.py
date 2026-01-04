"""
GraphEngine command entities for external control.

This module defines command types that can be sent to a running GraphEngine
instance to control its execution flow.
"""

from collections.abc import Sequence
from enum import StrEnum, auto
from typing import Any, TypeAlias

from pydantic import BaseModel, Field, model_validator

from core.file import File
from core.variables import Segment, SegmentType, Variable


class CommandType(StrEnum):
    """Types of commands that can be sent to GraphEngine."""

    ABORT = auto()
    PAUSE = auto()
    UPDATE_VARIABLES = auto()


class GraphEngineCommand(BaseModel):
    """Base class for all GraphEngine commands."""

    command_type: CommandType = Field(..., description="Type of command")
    payload: dict[str, Any] | None = Field(default=None, description="Optional command payload")


class AbortCommand(GraphEngineCommand):
    """Command to abort a running workflow execution."""

    command_type: CommandType = Field(default=CommandType.ABORT, description="Type of command")
    reason: str | None = Field(default=None, description="Optional reason for abort")


class PauseCommand(GraphEngineCommand):
    """Command to pause a running workflow execution."""

    command_type: CommandType = Field(default=CommandType.PAUSE, description="Type of command")
    reason: str = Field(default="unknown reason", description="reason for pause")


VariableUpdateValue: TypeAlias = File | Segment | Variable | str | int | float | dict[str, object] | list[object]


class VariableUpdate(BaseModel):
    """Represents a single variable update instruction."""

    selector: tuple[str, str] = Field(description="Variable selector (node_id, variable_name)")
    value_type: SegmentType = Field(description="Variable value type")
    value: VariableUpdateValue = Field(description="New variable value")

    @model_validator(mode="after")
    def _validate_value_type(self) -> "VariableUpdate":
        value_type = self.value_type
        value = self.value

        if isinstance(value, Variable | Segment):
            if value.value_type != value_type:
                raise ValueError(f"value type mismatch: expected {value_type}, got {value.value_type}")
            return self

        if isinstance(value, File):
            if value_type != SegmentType.FILE:
                raise ValueError(f"value type mismatch: expected {value_type}, got {SegmentType.FILE}")
            return self

        casted_value = SegmentType.cast_value(value, value_type)
        if not value_type.is_valid(casted_value):
            raise ValueError(f"value type mismatch: expected {value_type}, got {type(value).__name__}")

        self.value = casted_value
        return self


class UpdateVariablesCommand(GraphEngineCommand):
    """Command to update a group of variables in the variable pool."""

    command_type: CommandType = Field(default=CommandType.UPDATE_VARIABLES, description="Type of command")
    updates: Sequence[VariableUpdate] = Field(default_factory=list, description="Variable updates")
