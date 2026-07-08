from typing import ClassVar, Literal, Self
from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ShellAdapterSettings(BaseSettings):
    """Env-backed settings used to construct a shell provider.

    ``shellctl_auth_token`` defaults to ``None``; the factory forwards an empty
    string to the shellctl client so it does not fall back to ambient process
    credentials. Deployments that enable shellctl bearer auth must set
    ``DIFY_AGENT_SHELLCTL_AUTH_TOKEN`` explicitly.
    """

    shell_provider: Literal["shellctl", "enterprise"] = "shellctl"
    shellctl_entrypoint: str | None = None
    shellctl_auth_token: str | None = None

    enterprise_sandbox_gateway_endpoint: str | None = None
    enterprise_sandbox_gateway_auth_token: str | None = None

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def validate_provider_fields(self) -> Self:
        match self.shell_provider:
            case "shellctl":
                if not self.shellctl_entrypoint or not self.shellctl_entrypoint.strip():
                    raise ValueError("shellctl_entrypoint is required when shell_provider is 'shellctl'.")
                _validate_url(self.shellctl_entrypoint, field_name="shellctl_entrypoint")
            case "enterprise":
                if not self.enterprise_sandbox_gateway_endpoint or not self.enterprise_sandbox_gateway_endpoint.strip():
                    raise ValueError(
                        "enterprise_sandbox_gateway_endpoint is required when shell_provider is 'enterprise'."
                    )
                _validate_url(
                    self.enterprise_sandbox_gateway_endpoint, field_name="enterprise_sandbox_gateway_endpoint"
                )
        return self


def _validate_url(value: str, *, field_name: str) -> None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http(s) URL, got: {value!r}")


__all__ = [
    "ShellAdapterSettings",
]
