"""Credential check and OAuth revocation results returned by plugin providers."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, StrictBool

from constants.end_user_connections import CredentialCheckStatus


class AuthReasonCode(StrEnum):
    CREDENTIAL_INVALID = "credential_invalid"
    CREDENTIAL_EXPIRED = "credential_expired"
    CREDENTIAL_REVOKED = "credential_revoked"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_NETWORK_ERROR = "provider_network_error"
    PROVIDER_RATE_LIMITED = "provider_rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"


class OAuthRevokeStatus(StrEnum):
    REVOKED = "revoked"
    UNSUPPORTED = "unsupported"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"
    FAILED = "failed"


class CredentialCheckResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    # None means the provider supplied no more specific reason.
    reason_code: AuthReasonCode | None
    retryable: StrictBool
    status: CredentialCheckStatus


class CredentialCheckResult(CredentialCheckResponse):
    checked_at: int


class OAuthRevokeResult(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    reason_code: AuthReasonCode | None
    retryable: StrictBool
    status: OAuthRevokeStatus
