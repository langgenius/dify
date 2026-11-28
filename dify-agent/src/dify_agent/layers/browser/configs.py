"""Client-safe DTOs for the Dify browser layer.

The Runtime dependency supplies the active lease whose sandbox hosts the
Chromium instance. Public config carries product-level Agent Soul settings:
sub-agent budget, navigation policy, and session scope. Sandbox selection is
a deployment concern.
"""

from typing import Any, ClassVar, Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dify_agent.layers.browser.output_schema import OutputSchemaError, build_output_model


class DifyBrowserLayerConfig(BaseModel):
    """Public product behavior for the sandbox-backed Dify browser layer."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    runtime: str = "runtime"

    max_steps: int = Field(default=30, ge=1)
    use_vision: bool | Literal["auto"] = "auto"
    headless: bool = True
    allowed_domains: list[str] | None = None
    block_ip_addresses: bool = True
    session_scope: Literal["call", "agent"] = "call"
    use_judge: bool = False
    step_timeout_seconds: int = Field(default=180, ge=1)
    # JSON Schema the sub-agent's final result must conform to; ``None``
    # returns prose. Carried as plain JSON so the API can validate it.
    output_schema: dict[str, Any] | None = None
    # Secrets the sub-agent may type without its model ever seeing the values.
    # Flat keys apply to every allowed domain; the nested form scopes a secret
    # to one host. Values never reach the model, logs, or repr.
    sensitive_data: dict[str, str | dict[str, str]] | None = None
    # Persist browser login state (cookies) in the sandbox home so the next
    # run of the same agent starts signed in. Written and read inside the
    # sandbox; values never cross the sandbox boundary.
    persist_login_state: bool = False

    @field_validator("allowed_domains")
    @classmethod
    def _validate_allowed_domains(cls, value: list[str] | None) -> list[str] | None:
        # An empty allowlist would block every navigation; omitting the field
        # is the no-restriction form.
        if value is not None and not value:
            raise ValueError("allowed_domains must be omitted or non-empty")
        return value

    @field_validator("output_schema")
    @classmethod
    def _validate_output_schema(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        # Fail at config time, not mid-run: the model is compiled here so an
        # unsupported construct surfaces as a normal config validation error.
        if value is not None:
            try:
                build_output_model(value)
            except OutputSchemaError as exc:
                raise ValueError(str(exc)) from exc
        return value

    @model_validator(mode="after")
    def _validate_sensitive_data(self) -> Self:
        # Mirror the harness rule so a flat secret paired with a wildcard or
        # missing allowlist fails at config time, not mid-run.
        sensitive_data = self.sensitive_data
        if sensitive_data is None:
            return self
        has_flat_secrets = any(isinstance(value, str) for value in sensitive_data.values())
        if not has_flat_secrets:
            return self
        domains = self.allowed_domains or []
        if not domains or any(_domain_has_wildcard(domain) for domain in domains):
            raise ValueError(
                "Flat sensitive_data values require a non-empty allowed_domains with "
                "explicit hostnames (no wildcards); scope the secret per domain instead."
            )
        return self


def _domain_has_wildcard(domain: str) -> bool:
    hostname = urlsplit(domain).netloc or domain
    return "*" in hostname.split(":", 1)[0]


__all__ = [
    "DifyBrowserLayerConfig",
]
