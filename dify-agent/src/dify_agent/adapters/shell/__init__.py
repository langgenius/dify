"""Provider-agnostic shell adapter exports for the Dify agent.

Keep this package root light so importing shell protocols does not eagerly
require ``pydantic_settings`` or shellctl runtime dependencies.
"""

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
    ShellCommandStatus,
    ShellFileTransferProtocol,
    ShellPromptObservation,
    ShellProviderError,
)


def __getattr__(name: str) -> object:
    if name == "shellctl":
        from importlib import import_module

        return import_module("dify_agent.adapters.shell.shellctl")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "CompleteShellCommandResult",
    "ShellCommandProtocol",
    "ShellCommandResult",
    "ShellCommandStatus",
    "ShellFileTransferProtocol",
    "ShellPromptObservation",
    "ShellProviderError",
]
