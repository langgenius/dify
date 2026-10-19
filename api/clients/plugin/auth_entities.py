"""Tool authentication contracts shared with the plugin daemon.

Capabilities are opt-in per provider and installed plugin version. Neither an
OAuth schema nor the legacy boolean validator proves detailed check support.
"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class CredentialCheckCapabilities(BaseModel):
    api_key: StrictBool = False
    oauth2: StrictBool = False


class ProviderAuthCapabilities(BaseModel):
    credential_check: CredentialCheckCapabilities = Field(default_factory=CredentialCheckCapabilities)
    oauth_revoke_supported: StrictBool = False


AuthReasonCode = Literal[
    "credential_invalid",
    "credential_expired",
    "credential_revoked",
    "insufficient_permissions",
    "provider_timeout",
    "provider_network_error",
    "provider_rate_limited",
    "provider_unavailable",
    "unsupported",
    "protocol_error",
    "plugin_error",
    "daemon_unavailable",
    "unknown_error",
]


class _AuthResult(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    # None means the provider supplied no more specific reason.
    reason_code: AuthReasonCode | None
    retryable: StrictBool


class CredentialCheckResponse(_AuthResult):
    status: Literal["valid", "invalid", "temporarily_unavailable", "unsupported"]

    @model_validator(mode="after")
    def validate_retryable(self) -> Self:
        if self.retryable and self.status != "temporarily_unavailable":
            raise ValueError("Only temporarily unavailable checks can be retried")
        return self


class CredentialCheckResult(CredentialCheckResponse):
    checked_at: int


class OAuthRevokeResult(_AuthResult):
    status: Literal["revoked", "unsupported", "temporarily_unavailable", "failed"]

    @model_validator(mode="after")
    def validate_retryable(self) -> Self:
        if self.retryable and self.status != "temporarily_unavailable":
            raise ValueError("Only temporarily unavailable revocations can be retried")
        return self
