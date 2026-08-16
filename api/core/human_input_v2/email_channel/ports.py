"""Provider, protection, and transactional persistence ports for Email."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.shared import NormalizedEmail, TenantId

from .entities import (
    EmailChannelConfiguration,
    EmailConfigurationSnapshot,
    ProtectedAPIKey,
    ResendProviderSettings,
)


class EmailProviderValidationError(Exception):
    """Classified provider failure containing only a stable safe code."""

    code: str

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class EmailProviderOperationError(Exception):
    """Classified provider or transport failure containing only a stable safe code."""

    code: str

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class EmailProviderValidator(Protocol):
    """Concrete provider I/O implemented outside the domain package."""

    def validate(self, settings: ResendProviderSettings) -> None:
        """Validate credentials, permissions, sender, and domain without sending."""
        ...

    def send_test(self, settings: ResendProviderSettings, recipient: NormalizedEmail) -> None:
        """Send exactly one test message through the candidate settings."""
        ...


class EmailCredentialProtector(Protocol):
    """Workspace-scoped protection boundary for Resend credentials."""

    def protect(self, tenant_id: TenantId, api_key: str) -> ProtectedAPIKey: ...

    def reveal(self, tenant_id: TenantId, protected_api_key: ProtectedAPIKey) -> str: ...


class CreateEmailConfigurationStatus(StrEnum):
    """Stable outcome of creating the first workspace Email configuration."""

    # The workspace had no configuration and the new row was committed.
    CREATED = "created"

    # Another configuration already owns the workspace, including a concurrent creation winner.
    CONFLICT = "conflict"


@dataclass(frozen=True, slots=True)
class CreateEmailConfigurationResult:
    status: CreateEmailConfigurationStatus
    configuration: EmailChannelConfiguration | None


class UpdateEmailConfigurationStatus(StrEnum):
    """Outcome of an identity-and-timestamp guarded configuration update."""

    # The captured configuration snapshot still matched and the replacement was committed.
    UPDATED = "updated"

    # The captured identity or timestamp is no longer current; callers must reload before retrying.
    STALE = "stale"


@dataclass(frozen=True, slots=True)
class UpdateEmailConfigurationResult:
    status: UpdateEmailConfigurationStatus
    configuration: EmailChannelConfiguration | None


class DeleteEmailConfigurationStatus(StrEnum):
    """Outcome of deleting the current workspace Email configuration."""

    # The current workspace row was removed atomically.
    DELETED = "deleted"

    # No configuration exists in the trusted workspace scope.
    NOT_CONFIGURED = "not_configured"


@dataclass(frozen=True, slots=True)
class DeleteEmailConfigurationResult:
    status: DeleteEmailConfigurationStatus


class EmailChannelRepository(Protocol):
    """Operation-scoped transactional persistence for one workspace row."""

    def load(self, tenant_id: TenantId) -> EmailChannelConfiguration | None: ...

    def create(self, configuration: EmailChannelConfiguration) -> CreateEmailConfigurationResult: ...

    def update(
        self,
        configuration: EmailChannelConfiguration,
        *,
        expected: EmailConfigurationSnapshot,
        now: NaiveDatetime,
    ) -> UpdateEmailConfigurationResult: ...

    def delete(self, tenant_id: TenantId) -> DeleteEmailConfigurationResult: ...
