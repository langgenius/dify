"""Provider failures and transactional persistence ports for Email."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.shared import TenantId

from .entities import (
    EmailChannelConfiguration,
    EmailConfigurationSnapshot,
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


class EmailChannelPersistenceError(RuntimeError):
    """Credential-free failure raised by an Email persistence adapter."""


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
    """Outcome of an identity-and-revision guarded configuration update."""

    # The captured configuration snapshot still matched and the replacement was committed.
    UPDATED = "updated"

    # The captured identity or revision is no longer current; callers must reload before retrying.
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

    # The current row no longer matches the identity-and-revision snapshot.
    STALE = "stale"


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

    def delete(
        self,
        tenant_id: TenantId,
        *,
        expected: EmailConfigurationSnapshot,
    ) -> DeleteEmailConfigurationResult: ...
