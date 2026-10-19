"""Credential check and OAuth revocation results returned by plugin providers."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictBool

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


class CredentialCheckResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    # None means the provider supplied no more specific reason.
    reason_code: AuthReasonCode | None
    retryable: StrictBool
    status: Literal["valid", "invalid", "temporarily_unavailable", "unsupported"]


class CredentialCheckResult(CredentialCheckResponse):
    checked_at: int


class OAuthRevokeResult(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    reason_code: AuthReasonCode | None
    retryable: StrictBool
    status: Literal["revoked", "unsupported", "temporarily_unavailable", "failed"]
