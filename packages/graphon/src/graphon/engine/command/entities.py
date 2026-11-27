"""Engine command entities for external control.

This module defines command types that can be sent to a running Engine
instance to control its execution flow.
"""

from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from graphon.variables.variables import Variable


class AbortCommand(BaseModel):
    """Command to abort a running workflow execution."""

    command_type: Literal["abort"] = "abort"
    reason: str | None = Field(default=None, description="Optional reason for abort")


class PauseCommand(BaseModel):
    """Command to pause a running workflow execution."""

    command_type: Literal["pause"] = "pause"
    reason: str = Field(default="unknown reason", description="reason for pause")


class UpdateVariablesCommand(BaseModel):
    """Command to update a group of variables in the variable pool."""

    command_type: Literal["update_variables"] = "update_variables"
    updates: Sequence[Variable] = Field(
        default_factory=list,
        description="Variable updates",
    )


type Command = Annotated[
    AbortCommand | PauseCommand | UpdateVariablesCommand,
    Field(discriminator="command_type"),
]
