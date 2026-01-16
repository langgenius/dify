"""
GraphEngine command entities for external control.

This module defines command types that can be sent to a running GraphEngine
instance to control its execution flow.
"""

from collections.abc import Sequence
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, Field

from core.variables.variables import Variable


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


class VariableUpdate(BaseModel):
    """Represents a single variable update instruction."""

    value: Variable = Field(description="New variable value")


class UpdateVariablesCommand(GraphEngineCommand):
    """Command to update a group of variables in the variable pool."""

    command_type: CommandType = Field(default=CommandType.UPDATE_VARIABLES, description="Type of command")
    updates: Sequence[VariableUpdate] = Field(default_factory=list, description="Variable updates")
