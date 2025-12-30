from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Arch(StrEnum):
    """
    Architecture types for virtual environments.
    """

    ARM64 = "arm64"
    AMD64 = "amd64"


class Metadata(BaseModel):
    """
    Returned metadata about a virtual environment.
    """

    id: str = Field(description="The unique identifier of the virtual environment.")
    arch: Arch = Field(description="Which architecture was used to create the virtual environment.")
    store: Mapping[str, Any] = Field(
        default_factory=dict, description="The store information of the virtual environment., Additional data."
    )


class ConnectionHandle(BaseModel):
    """
    Handle for managing connections to the virtual environment.
    """

    id: str = Field(description="The unique identifier of the connection handle.")


class CommandStatus(BaseModel):
    """
    Status of a command executed in the virtual environment.
    """

    class Status(StrEnum):
        RUNNING = "running"
        COMPLETED = "completed"

    status: Status = Field(description="The status of the command execution.")
    exit_code: int | None = Field(description="The return code of the command execution.")


class FileState(BaseModel):
    """
    State of a file in the virtual environment.
    """

    size: int = Field(description="The size of the file in bytes.")
    path: str = Field(description="The path of the file in the virtual environment.")
    created_at: int = Field(description="The creation timestamp of the file.")
    updated_at: int = Field(description="The last modified timestamp of the file.")
