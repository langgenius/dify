"""Transport boundary shared by ordinary and explicitly injected code execution."""

from typing import Protocol

from pydantic import BaseModel


class CodeExecutionTransport(Protocol):
    def execute(self, *, language: str, preload: str, code: str) -> str:
        """Execute transformed code and return raw stdout for response transformation."""
        ...


class CodeExecutionError(Exception):
    pass


class CodeExecutionResponse(BaseModel):
    class Data(BaseModel):
        stdout: str | None = None
        error: str | None = None

    code: int
    message: str
    data: Data
