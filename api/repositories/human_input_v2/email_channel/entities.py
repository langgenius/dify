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
class ResendCandidate:
    """Complete candidate settings for a Resend save or test operation."""

    sender_email: NormalizedEmail
    sender_name: str
    api_key: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.api_key.strip():
            raise ValueError("API key must not be blank")
        sender_name = self.sender_name.strip()
        if not sender_name:
            raise ValueError("sender name must not be blank")
        object.__setattr__(self, "sender_name", sender_name)


@dataclass(frozen=True, slots=True)
class EmailConfigurationSnapshot:
    """Complete internal token guarding a validated configuration write."""

    configuration_id: EmailProviderId
    config_version: int

    def __post_init__(self) -> None:
        if self.config_version < 1:
            raise ValueError("config version must be positive")


@dataclass(frozen=True, slots=True)
class EmailChannelConfiguration:
    """Workspace-owned Resend configuration independent from ORM lifetime."""

    id: EmailProviderId
    tenant_id: TenantId
    sender_email: NormalizedEmail
    sender_name: str
    protected_api_key: str = field(repr=False)
    configured_by_account_id: AccountId | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    config_version: int = 1
    provider: EmailProviderType = EmailProviderType.RESEND

    def __post_init__(self) -> None:
        if self.provider is not EmailProviderType.RESEND:
            raise ValueError("only the Resend email provider is supported")
        if not self.protected_api_key:
            raise ValueError("protected API key must not be empty")
        if self.config_version < 1:
            raise ValueError("config version must be positive")

    @property
    def snapshot(self) -> EmailConfigurationSnapshot:
        return EmailConfigurationSnapshot(self.id, self.config_version)


@dataclass(frozen=True, slots=True)
class EmailChannelView:
    """Credential-free configuration state exposed by the Email owner."""

    id: EmailProviderId
    provider: EmailProviderType
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    sender_name: str
    sender_email: str
    revision: EmailConfigurationSnapshot
