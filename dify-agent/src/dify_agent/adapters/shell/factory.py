from dify_agent.adapters.shell.config import ShellAdapterSettings
from dify_agent.adapters.shell.protocols import ShellProvisionProtocol
from dify_agent.adapters.shell.shellctl import ShellctlEnvironmentDescriptor, ShellctlProvisioner, create_default_shellctl_client_factory


def create_shell_provisioner(settings: ShellAdapterSettings | None = None) -> ShellProvisionProtocol[ShellctlEnvironmentDescriptor]:
    """Return the shell provisioner selected by ``DIFY_AGENT_SHELL_PROVIDER``.

    Raises:
        ValueError: if the provider name is unknown, or if the ``shellctl``
            provider is selected without a non-empty ``DIFY_AGENT_SHELLCTL_ENTRYPOINT``.
    """
    resolved = settings or ShellAdapterSettings()
    provider = resolved.shell_provider.strip().lower()
    match provider:
        case "shellctl":
            entrypoint = (resolved.shellctl_entrypoint or "").strip()
            if not entrypoint:
                raise ValueError("DIFY_AGENT_SHELLCTL_ENTRYPOINT is required for the 'shellctl' shell provider.")
            return ShellctlProvisioner(
                client_factory=create_default_shellctl_client_factory(
                    entrypoint=entrypoint,
                    token=resolved.shellctl_auth_token or "",
                ),
            )
        case _:
            raise ValueError(f"Unknown shell provider: {resolved.shell_provider!r}.")


__all__ = ["create_shell_provisioner"]
