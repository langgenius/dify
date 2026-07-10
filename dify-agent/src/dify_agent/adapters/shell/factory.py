from dify_agent.adapters.shell.config import ShellAdapterSettings
from dify_agent.adapters.shell.enterprise import EnterpriseShellProvider
from dify_agent.adapters.shell.protocols import ShellProviderProtocol
from dify_agent.adapters.shell.shellctl import ShellctlProvider


def create_shell_provider(settings: ShellAdapterSettings | None = None) -> ShellProviderProtocol:
    """Return the shell provider selected by ``DIFY_AGENT_SHELL_PROVIDER``."""
    resolved = settings or ShellAdapterSettings()
    provider = resolved.shell_provider
    match provider:
        case "shellctl":
            entrypoint = (resolved.shellctl_entrypoint or "").strip()
            if not entrypoint:
                raise ValueError("DIFY_AGENT_SHELLCTL_ENTRYPOINT is required for the 'shellctl' shell provider.")
            return ShellctlProvider(
                entrypoint=entrypoint,
                token=resolved.shellctl_auth_token or "",
            )
        case "enterprise":
            return EnterpriseShellProvider(
                gateway_endpoint=(resolved.enterprise_sandbox_gateway_endpoint or "").strip(),
                auth_token=resolved.enterprise_sandbox_gateway_auth_token or "",
                gateway_timeout=resolved.enterprise_sandbox_gateway_timeout,
                proxy_timeout=resolved.enterprise_sandbox_proxy_timeout,
            )
        case _:
            raise ValueError(f"Unknown shell provider: {resolved.shell_provider!r}.")


__all__ = ["create_shell_provider"]
