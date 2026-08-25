"""Immutable append-only reconciliation change-log values."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import ProviderUserId
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
)


class IMReconciliationSubjectKind(StrEnum):
    IDENTITY = "identity"
    BINDING = "binding"


class IMReconciliationOperation(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    REFRESH = "refresh"
    REPLACE = "replace"
    DELETE = "delete"


@dataclass(frozen=True, slots=True)
class IMIdentityChangeSnapshot:
    identity_id: IMIdentityId
    provider: IMProvider
    provider_user_id: ProviderUserId
    display_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    last_seen_sync_run_id: IMSyncRunId | None


@dataclass(frozen=True, slots=True)
class IMBindingChangeSnapshot:
    binding_id: IMBindingId
    identity_id: IMIdentityId
    contact_id: ContactId


type IMReconciliationSnapshot = IMIdentityChangeSnapshot | IMBindingChangeSnapshot


@dataclass(frozen=True, slots=True)
class IMReconciliationChange:
    """One append-only identity or IM binding mutation committed by a sync run."""

    id: IMReconciliationChangeId
    integration_id: IntegrationId
    sync_run_id: IMSyncRunId
    operation_key: str
    subject_kind: IMReconciliationSubjectKind
    operation: IMReconciliationOperation
    reason_code: str
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    contact_id: ContactId | None
    before: IMReconciliationSnapshot | None
    after: IMReconciliationSnapshot | None
    committed_at: NaiveDatetime

    def __post_init__(self) -> None:
        if not self.operation_key:
            raise ValueError("operation key must not be empty")
        expected_snapshot_type = (
            IMIdentityChangeSnapshot
            if self.subject_kind is IMReconciliationSubjectKind.IDENTITY
            else IMBindingChangeSnapshot
        )
        if self.before is not None and not isinstance(self.before, expected_snapshot_type):
            raise ValueError("before snapshot does not match subject kind")
        if self.after is not None and not isinstance(self.after, expected_snapshot_type):
            raise ValueError("after snapshot does not match subject kind")
        if self.operation is IMReconciliationOperation.CREATE and (self.before is not None or self.after is None):
            raise ValueError("create requires only an after snapshot")
        if self.operation is IMReconciliationOperation.DELETE and (self.before is None or self.after is not None):
            raise ValueError("delete requires only a before snapshot")
        if self.operation not in (IMReconciliationOperation.CREATE, IMReconciliationOperation.DELETE) and (
            self.before is None or self.after is None
        ):
            raise ValueError("mutation requires before and after snapshots")
        if self.subject_kind is IMReconciliationSubjectKind.IDENTITY:
            if self.operation is IMReconciliationOperation.REPLACE or self.binding_id is not None:
                raise ValueError("identity change cannot represent an IM binding replacement")
        elif self.operation in (IMReconciliationOperation.UPDATE, IMReconciliationOperation.REFRESH):
            raise ValueError("IM binding change cannot use an identity-only operation")
