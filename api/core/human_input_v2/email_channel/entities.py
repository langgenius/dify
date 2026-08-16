"""Credential-safe values for the workspace Resend configuration lifecycle."""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import NaiveDatetime

from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)


@dataclass(frozen=True, slots=True)
class NewAPIKey:
    """A transient plaintext credential accepted only at a provider boundary."""

    value: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("API key must not be blank")


@dataclass(frozen=True, slots=True)
class RetainExistingAPIKey:
    """Explicit instruction to validate and preserve the current credential."""


@dataclass(frozen=True, slots=True)
class ProtectedAPIKey:
    """Opaque protected credential that is never part of a safe projection."""

    value: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.value:
            raise ValueError("protected API key must not be empty")


type APIKeyDirective = NewAPIKey | RetainExistingAPIKey


@dataclass(frozen=True, slots=True)
class ResendCandidate:
    """Complete candidate settings for a Resend save or test operation."""

    sender_email: NormalizedEmail
    sender_name: str
    api_key: APIKeyDirective = field(repr=False)
    provider: EmailProviderType = field(default=EmailProviderType.RESEND, init=False)

    def __post_init__(self) -> None:
        if self.provider is not EmailProviderType.RESEND:
            raise ValueError("only the Resend email provider is supported")
        object.__setattr__(self, "sender_name", self.sender_name.strip())


@dataclass(frozen=True, slots=True)
class ResendProviderSettings:
    """Transient complete settings supplied to the provider validation port."""

    sender_email: NormalizedEmail
    sender_name: str
    api_key: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class EmailConfigurationSnapshot:
    """Complete internal token guarding a validated configuration write."""

    configuration_id: EmailProviderId
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class EmailChannelConfiguration:
    """Workspace-owned Resend configuration independent from ORM lifetime."""

    id: EmailProviderId
    tenant_id: TenantId
    sender_email: NormalizedEmail
    sender_name: str
    protected_api_key: ProtectedAPIKey = field(repr=False)
    configured_by_account_id: AccountId | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    provider: EmailProviderType = EmailProviderType.RESEND

    def __post_init__(self) -> None:
        if self.provider is not EmailProviderType.RESEND:
            raise ValueError("only the Resend email provider is supported")

    @property
    def snapshot(self) -> EmailConfigurationSnapshot:
        return EmailConfigurationSnapshot(self.id, self.updated_at)
