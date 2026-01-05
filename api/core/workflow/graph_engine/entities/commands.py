"""
GraphEngine command entities for external control.

This module defines command types that can be sent to a running GraphEngine
instance to control its execution flow.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class CommandType(StrEnum):
    """Types of commands that can be sent to GraphEngine."""

    ABORT = "abort"
    PAUSE = "pause"


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
