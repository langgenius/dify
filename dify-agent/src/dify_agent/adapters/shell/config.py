"""Environment-driven selection of the shell adapter provider.

``ShellAdapterSettings`` reads the ``DIFY_AGENT_`` env namespace (the same prefix
as ``dify_agent.server.settings.ServerSettings``), so the shellctl entrypoint and
auth token are sourced from the existing ``DIFY_AGENT_SHELLCTL_ENTRYPOINT`` /
``DIFY_AGENT_SHELLCTL_AUTH_TOKEN`` variables. ``DIFY_AGENT_SHELL_PROVIDER`` selects
which backend ``dify_agent.adapters.shell.factory.create_shell_provisioner`` builds
and defaults to ``shellctl``.
"""

from typing import ClassVar

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SHELL_PROVIDER = "shellctl"


class ShellAdapterSettings(BaseSettings):
    """Env-backed settings used to construct a shell provisioner.

    ``shellctl_auth_token`` defaults to ``None``; the factory forwards an empty
    string to the shellctl client so it does not fall back to ambient process
    credentials. Deployments that enable shellctl bearer auth must set
    ``DIFY_AGENT_SHELLCTL_AUTH_TOKEN`` explicitly.
    """

    shell_provider: str = DEFAULT_SHELL_PROVIDER
    shellctl_entrypoint: str | None = None
    shellctl_auth_token: str | None = None

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
        populate_by_name=True,
    )


__all__ = ["DEFAULT_SHELL_PROVIDER", "ShellAdapterSettings"]
