"""Provider-agnostic shell adapter exports for the Dify agent."""

from dify_agent.adapters.shell.config import DEFAULT_SHELL_PROVIDER, ShellAdapterSettings
from dify_agent.adapters.shell.factory import create_shell_provider
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
