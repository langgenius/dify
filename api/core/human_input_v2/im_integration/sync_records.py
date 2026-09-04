"""Immutable synchronization run and product-result persistence values."""

from __future__ import annotations

from dataclasses import dataclass, replace

from pydantic import NaiveDatetime

from core.human_input_v2.entities import (
    IMIdentityBindingStatus,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
)

from .records import OpaqueProviderPayload


@dataclass(frozen=True, slots=True)
class IMChannelRevision:
    """Historical configuration token captured by one synchronization run."""

    channel_id: str
    config_version: int

    def __post_init__(self) -> None:
        if self.config_version < 1:
            raise ValueError("config version must be positive")


@dataclass(frozen=True, slots=True)
class StaleRevision:
    """Stable rejection for a synchronization token that is no longer current."""

    expected: IMChannelRevision
    actual: IMChannelRevision | None


@dataclass(frozen=True, slots=True)
class SyncContactSnapshot:
    """Immutable Contact display values retained by a historical result."""

    contact_id: ContactId
    name: str
    email: str | None
    avatar_file_id: str | None
    created_at: NaiveDatetime | None = None


@dataclass(frozen=True, slots=True)
class SyncIdentitySnapshot:
    """Immutable last-known provider identity retained after current deletion."""

    identity_id: IMIdentityId
    provider: IMProvider
    provider_user_id: str
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class SyncResultFact:
    """Append-only product outcome for one binding decision or diagnostic."""

    id: IMSyncResultId
    integration_id: IntegrationId
    sync_run_id: IMSyncRunId
    operation_key: str | None
    result_type: IMSyncResultType
    provider_user_id: str | None
    display_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    contact_id: ContactId | None
    identity_id: IMIdentityId | None
    binding_id: IMBindingId | None
    removal_reason: IMSyncRemovalReason | None
    reason_code: str | None
    reason_message: str | None
    directory_entry_payload: OpaqueProviderPayload | None
    contact_snapshot: SyncContactSnapshot | None
    identity_snapshot: SyncIdentitySnapshot | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class SyncResultPage:
    """Stable one-bucket page of product-facing synchronization facts."""

    items: tuple[SyncResultFact, ...]
    page: int
    limit: int
    total: int


@dataclass(frozen=True, slots=True)
class SynchronizedIMIdentity:
    """Search-safe current identity projection without Provider raw payload."""

    id: IMIdentityId
    provider: IMProvider
    provider_user_id: str
    display_name: str | None
    email: str | None
    binding_status: IMIdentityBindingStatus


@dataclass(frozen=True, slots=True)
class SynchronizedIMIdentityPage:
    """Stable page of current synchronized identities."""

    items: tuple[SynchronizedIMIdentity, ...]
    page: int
    limit: int
    total: int


@dataclass(frozen=True, slots=True)
class IMSyncRun:
    """Independent sync aggregate that captures one complete Channel revision."""

    id: IMSyncRunId
    channel_revision: IMChannelRevision
    provider: IMProvider
    status: IMSyncRunStatus
    added_count: int
    not_matched_count: int
    failed_count: int
    removed_count: int
    skipped_count: int
    started_by_account_id: AccountId | None
    started_at: NaiveDatetime | None
    finished_at: NaiveDatetime | None
    error_code: str | None
    error_message: str | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    @classmethod
    def create(
        cls,
        *,
        sync_run_id: IMSyncRunId,
        channel_revision: IMChannelRevision,
        provider: IMProvider,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> IMSyncRun:
        return cls(
            id=sync_run_id,
            channel_revision=channel_revision,
            provider=provider,
            status=IMSyncRunStatus.QUEUED,
            added_count=0,
            not_matched_count=0,
            failed_count=0,
            removed_count=0,
            skipped_count=0,
            started_by_account_id=started_by_account_id,
            started_at=None,
            finished_at=None,
            error_code=None,
            error_message=None,
            created_at=now,
            updated_at=now,
        )

    @property
    def is_active(self) -> bool:
        return self.status in (IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)

    def start(self, now: NaiveDatetime) -> IMSyncRun:
        if self.status is not IMSyncRunStatus.QUEUED:
            return self
        return replace(self, status=IMSyncRunStatus.RUNNING, started_at=now, updated_at=now)
