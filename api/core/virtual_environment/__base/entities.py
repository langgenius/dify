from enum import StrEnum

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


class ConnectionHandle(BaseModel):
    """
    Handle for managing connections to the virtual environment.
    """

    id: str = Field(description="The unique identifier of the connection handle.")


class CommandStatus(BaseModel):
    """
    Status of a command executed in the virtual environment.
    """

    pid: int = Field(description="The process ID of the command.")
    return_code: int = Field(description="The return code of the command execution.")
