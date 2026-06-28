"""Provider-agnostic shell provisioning/execution adapter for the Dify agent.

The boundary protocols live in ``protocols``; the default shellctl backend in
``shellctl``; and env-var-driven provider selection in ``config``/``factory``.
``create_shell_provisioner`` is the recommended entry point for callers.
"""

from dify_agent.adapters.shell.config import DEFAULT_SHELL_PROVIDER, ShellAdapterSettings
from dify_agent.adapters.shell.factory import create_shell_provisioner
from dify_agent.adapters.shell.protocols import (
    ShellEnvironmentDescriptor,
    ShellExecutionResult,
    ShellExecutorProtocol,
    ShellFileTransferProtocol,
    ShellHandle,
    ShellProvisionProtocol,
)
from dify_agent.adapters.shell.shellctl import (
    ShellctlEnvironmentDescriptor,
    ShellctlProvisioner,
    ShellFileTransferError,
    ShellProvisionError,
    create_default_shellctl_client_factory,
)

__all__ = [
    "DEFAULT_SHELL_PROVIDER",
    "ShellAdapterSettings",
    "ShellEnvironmentDescriptor",
    "ShellExecutionResult",
    "ShellExecutorProtocol",
    "ShellFileTransferError",
    "ShellFileTransferProtocol",
    "ShellHandle",
    "ShellProvisionError",
    "ShellProvisionProtocol",
    "ShellctlEnvironmentDescriptor",
    "ShellctlProvisioner",
    "create_default_shellctl_client_factory",
    "create_shell_provisioner",
]
