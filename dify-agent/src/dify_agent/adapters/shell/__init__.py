"""Provider-agnostic shell adapter exports for the Dify agent.

Keep this package root light so importing shell protocols does not eagerly
require ``pydantic_settings`` or shellctl runtime dependencies.
"""

from importlib import import_module

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
    ShellCommandStatus,
    ShellFileTransferProtocol,
    ShellPromptObservation,
    ShellProviderError,
    ShellProviderProtocol,
    ShellResourceProtocol,
)


def __getattr__(name: str) -> object:
    if name in {"DEFAULT_SHELL_PROVIDER", "ShellAdapterSettings"}:
        return getattr(import_module("dify_agent.adapters.shell.config"), name)
    if name == "create_shell_provider":
        return getattr(import_module("dify_agent.adapters.shell.factory"), name)
    if name == "shellctl":
        return import_module("dify_agent.adapters.shell.shellctl")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "CompleteShellCommandResult",
    "DEFAULT_SHELL_PROVIDER",
    "ShellAdapterSettings",
    "ShellCommandProtocol",
    "ShellCommandResult",
    "ShellCommandStatus",
    "ShellFileTransferProtocol",
    "ShellPromptObservation",
    "ShellProviderError",
    "ShellProviderProtocol",
    "ShellResourceProtocol",
    "create_shell_provider",
]
