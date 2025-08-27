"""
GraphEngine command entities for external control.

This module defines command types that can be sent to a running GraphEngine
instance to control its execution flow.
"""

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class CommandType(str, Enum):
    """Types of commands that can be sent to GraphEngine."""

    ABORT = "abort"
    PAUSE = "pause"
    RESUME = "resume"


class GraphEngineCommand(BaseModel):
    """Base class for all GraphEngine commands."""

    command_type: CommandType = Field(..., description="Type of command")
    payload: Optional[dict[str, Any]] = Field(default=None, description="Optional command payload")


class AbortCommand(GraphEngineCommand):
    """Command to abort a running workflow execution."""

    command_type: CommandType = Field(default=CommandType.ABORT, description="Type of command")
    reason: Optional[str] = Field(default=None, description="Optional reason for abort")
