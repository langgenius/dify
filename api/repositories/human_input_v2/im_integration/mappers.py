"""Explicit bidirectional mappings for IM domain values and ORM records."""

from datetime import datetime

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMBindingScope, IMSyncRemovalReason
from core.human_input_v2.im_integration import (
    IMBinding,
    IMBindingChangeSnapshot,
    IMIdentity,
    IMIdentityChangeSnapshot,
    IMReconciliationChange,
    IMReconciliationSubjectKind,
    IMSyncRun,
    IntegrationRevisionToken,
    OpaqueProviderPayload,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.im_integration.adapters.entities import ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
)
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMBindingReconciliationSnapshot,
    IMIdentityRawPayload,
    IMIdentityReconciliationSnapshot,
    IMSyncContactSnapshot,
    IMSyncDirectoryEntryPayload,
    IMSyncIdentitySnapshot,
)


def _timestamp(value: datetime) -> NaiveDatetime:
    """Interpret database-naive timestamps as UTC, matching Dify persistence."""

    return ensure_naive_utc(value)


def identity_from_record(record: HumanInputIMIdentity) -> IMIdentity:
    """Map one current provider identity record into a domain value."""

    return IMIdentity(
        id=IMIdentityId(record.id),
        integration_id=IntegrationId(record.integration_id),
        provider=record.provider,
        provider_user_id=record.provider_user_id,
        display_name=record.display_name,
        normalized_name=record.normalized_name,
        email=record.email,
        normalized_email=NormalizedEmail(record.normalized_email) if record.normalized_email is not None else None,
        raw_payload=OpaqueProviderPayload.from_mapping(record.raw_payload.root),
        last_seen_sync_run_id=(
            IMSyncRunId(record.last_seen_sync_run_id) if record.last_seen_sync_run_id is not None else None
        ),
        last_seen_at=_timestamp(record.last_seen_at) if record.last_seen_at is not None else None,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def identity_to_record(identity: IMIdentity) -> HumanInputIMIdentity:
    """Map one current provider identity into a detached record."""

    record = HumanInputIMIdentity(
        integration_id=str(identity.integration_id),
        provider=identity.provider,
        provider_user_id=identity.provider_user_id,
        display_name=identity.display_name,
        normalized_name=identity.normalized_name,
        email=identity.email,
        normalized_email=str(identity.normalized_email) if identity.normalized_email is not None else None,
        raw_payload=IMIdentityRawPayload(identity.raw_payload.to_mapping()),
        last_seen_sync_run_id=(
            str(identity.last_seen_sync_run_id) if identity.last_seen_sync_run_id is not None else None
        ),
        last_seen_at=identity.last_seen_at if identity.last_seen_at is not None else None,
    )
    record.id = str(identity.id)
    record.created_at = identity.created_at
    record.updated_at = identity.updated_at
    return record


def binding_from_record(record: HumanInputIMBinding) -> IMBinding:
    """Map one current binding record into a domain value."""

    return IMBinding(
        id=IMBindingId(record.id),
        integration_id=IntegrationId(record.integration_id),
        scope=IMBindingScope(record.scope),
        scope_id=record.scope_id,
        contact_id=ContactId(record.contact_id),
        identity_id=IMIdentityId(record.im_identity_id),
        provider=record.provider,
        bound_by_account_id=AccountId(record.bound_by_account_id) if record.bound_by_account_id is not None else None,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def binding_to_record(binding: IMBinding) -> HumanInputIMBinding:
    """Map one current binding into a detached record."""

    record = HumanInputIMBinding(
        integration_id=str(binding.integration_id),
        scope=binding.scope,
        scope_id=binding.scope_id,
        contact_id=str(binding.contact_id),
        im_identity_id=str(binding.identity_id),
        provider=binding.provider,
        bound_by_account_id=str(binding.bound_by_account_id) if binding.bound_by_account_id is not None else None,
    )
    record.id = str(binding.id)
    record.created_at = binding.created_at
    record.updated_at = binding.updated_at
    return record


def sync_run_from_record(record: HumanInputIMSyncRun) -> IMSyncRun:
    """Map one sync run record into its independent aggregate."""

    return IMSyncRun(
        id=IMSyncRunId(record.id),
        integration_revision=IntegrationRevisionToken(
            IntegrationId(record.integration_id), record.integration_config_version
        ),
        provider=record.provider,
        status=record.status,
        added_count=record.added_count,
        not_matched_count=record.not_matched_count,
        failed_count=record.failed_count,
        removed_count=record.removed_count,
        skipped_count=record.skipped_count,
        started_by_account_id=(
            AccountId(record.started_by_account_id) if record.started_by_account_id is not None else None
        ),
        started_at=_timestamp(record.started_at) if record.started_at is not None else None,
        finished_at=_timestamp(record.finished_at) if record.finished_at is not None else None,
        error_code=record.error_code,
        error_message=record.error_message,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def sync_run_to_record(run: IMSyncRun) -> HumanInputIMSyncRun:
    """Map one sync aggregate into a detached record."""

    record = HumanInputIMSyncRun(
        integration_id=str(run.integration_revision.integration_id),
        integration_config_version=run.integration_revision.config_version,
        provider=run.provider,
        status=run.status,
        added_count=run.added_count,
        not_matched_count=run.not_matched_count,
        failed_count=run.failed_count,
        removed_count=run.removed_count,
        skipped_count=run.skipped_count,
        started_by_account_id=str(run.started_by_account_id) if run.started_by_account_id is not None else None,
        started_at=run.started_at if run.started_at is not None else None,
        finished_at=run.finished_at if run.finished_at is not None else None,
        error_code=run.error_code,
        error_message=run.error_message,
    )
    record.id = str(run.id)
    record.created_at = run.created_at
    record.updated_at = run.updated_at
    return record


def sync_result_from_record(record: HumanInputIMSyncResult) -> SyncResultFact:
    """Map one append-only result record into an immutable domain fact."""

    contact_snapshot = record.contact_snapshot
    identity_snapshot = record.identity_snapshot
    return SyncResultFact(
        id=IMSyncResultId(record.id),
        integration_id=IntegrationId(record.integration_id),
        sync_run_id=IMSyncRunId(record.sync_run_id),
        operation_key=record.operation_key,
        result_type=record.result_type,
        provider_user_id=record.provider_user_id,
        display_name=record.display_name,
        email=record.email,
        normalized_email=NormalizedEmail(record.normalized_email) if record.normalized_email is not None else None,
        contact_id=ContactId(record.contact_id) if record.contact_id is not None else None,
        identity_id=IMIdentityId(record.im_identity_id) if record.im_identity_id is not None else None,
        binding_id=IMBindingId(record.im_binding_id) if record.im_binding_id is not None else None,
        removal_reason=IMSyncRemovalReason(record.removal_reason) if record.removal_reason is not None else None,
        reason_code=record.reason_code,
        reason_message=record.reason_message,
        directory_entry_payload=(
            OpaqueProviderPayload.from_mapping(record.directory_entry_payload.root)
            if record.directory_entry_payload is not None
            else None
        ),
        contact_snapshot=(
            SyncContactSnapshot(
                contact_id=ContactId(contact_snapshot.contact_id),
                name=contact_snapshot.name,
                email=contact_snapshot.email,
                avatar_file_id=contact_snapshot.avatar_file_id,
                created_at=(
                    _timestamp(contact_snapshot.created_at) if contact_snapshot.created_at is not None else None
                ),
            )
            if contact_snapshot is not None
            else None
        ),
        identity_snapshot=(
            SyncIdentitySnapshot(
                identity_id=IMIdentityId(identity_snapshot.identity_id),
                provider=identity_snapshot.provider,
                provider_user_id=identity_snapshot.provider_user_id,
                display_name=identity_snapshot.display_name,
                email=identity_snapshot.email,
            )
            if identity_snapshot is not None
            else None
        ),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def sync_result_to_record(result: SyncResultFact) -> HumanInputIMSyncResult:
    """Map one immutable sync result fact into a detached record."""

    contact_snapshot = result.contact_snapshot
    identity_snapshot = result.identity_snapshot
    record = HumanInputIMSyncResult(
        integration_id=str(result.integration_id),
        sync_run_id=str(result.sync_run_id),
        operation_key=result.operation_key,
        result_type=result.result_type,
        provider_user_id=result.provider_user_id,
        display_name=result.display_name,
        email=result.email,
        normalized_email=str(result.normalized_email) if result.normalized_email is not None else None,
        contact_id=str(result.contact_id) if result.contact_id is not None else None,
        im_identity_id=str(result.identity_id) if result.identity_id is not None else None,
        im_binding_id=str(result.binding_id) if result.binding_id is not None else None,
        removal_reason=result.removal_reason,
        reason_code=result.reason_code,
        reason_message=result.reason_message,
        directory_entry_payload=(
            IMSyncDirectoryEntryPayload(result.directory_entry_payload.to_mapping())
            if result.directory_entry_payload is not None
            else None
        ),
        contact_snapshot=(
            IMSyncContactSnapshot(
                contact_id=str(contact_snapshot.contact_id),
                name=contact_snapshot.name,
                email=contact_snapshot.email,
                avatar_file_id=contact_snapshot.avatar_file_id,
                created_at=contact_snapshot.created_at,
            )
            if contact_snapshot is not None
            else None
        ),
        identity_snapshot=(
            IMSyncIdentitySnapshot(
                identity_id=str(identity_snapshot.identity_id),
                provider=identity_snapshot.provider,
                provider_user_id=identity_snapshot.provider_user_id,
                display_name=identity_snapshot.display_name,
                email=identity_snapshot.email,
            )
            if identity_snapshot is not None
            else None
        ),
    )
    record.id = str(result.id)
    record.created_at = result.created_at
    record.updated_at = result.updated_at
    return record


def reconciliation_change_from_record(record: HumanInputIMReconciliationChange) -> IMReconciliationChange:
    """Map one append-only ORM change record into an immutable application value."""

    return IMReconciliationChange(
        id=IMReconciliationChangeId(record.id),
        integration_id=IntegrationId(record.integration_id),
        sync_run_id=IMSyncRunId(record.sync_run_id),
        operation_key=record.operation_key,
        subject_kind=record.subject_kind,
        operation=record.operation,
        reason_code=record.reason_code,
        identity_id=IMIdentityId(record.im_identity_id),
        binding_id=IMBindingId(record.im_binding_id) if record.im_binding_id is not None else None,
        contact_id=ContactId(record.contact_id) if record.contact_id is not None else None,
        before=_change_snapshot_from_record(record.before_snapshot),
        after=_change_snapshot_from_record(record.after_snapshot),
        committed_at=_timestamp(record.committed_at),
    )


def reconciliation_change_to_record(change: IMReconciliationChange) -> HumanInputIMReconciliationChange:
    """Map one immutable change value into a detached append-only ORM record."""

    record = HumanInputIMReconciliationChange(
        integration_id=str(change.integration_id),
        sync_run_id=str(change.sync_run_id),
        operation_key=change.operation_key,
        subject_kind=change.subject_kind,
        operation=change.operation,
        reason_code=change.reason_code,
        im_identity_id=str(change.identity_id),
        im_binding_id=str(change.binding_id) if change.binding_id is not None else None,
        contact_id=str(change.contact_id) if change.contact_id is not None else None,
        before_snapshot=_change_snapshot_to_record(change.before),
        after_snapshot=_change_snapshot_to_record(change.after),
        committed_at=change.committed_at,
    )
    record.id = str(change.id)
    record.created_at = change.committed_at
    record.updated_at = change.committed_at
    return record


def _change_snapshot_from_record(
    snapshot: IMIdentityReconciliationSnapshot | IMBindingReconciliationSnapshot | None,
) -> IMIdentityChangeSnapshot | IMBindingChangeSnapshot | None:
    if snapshot is None:
        return None
    if snapshot.subject_kind is IMReconciliationSubjectKind.IDENTITY:
        if not isinstance(snapshot, IMIdentityReconciliationSnapshot):
            raise ValueError("identity change contains an invalid snapshot")
        return IMIdentityChangeSnapshot(
            identity_id=IMIdentityId(snapshot.identity_id),
            provider=snapshot.provider,
            provider_user_id=ProviderUserId(snapshot.provider_user_id),
            display_name=snapshot.display_name,
            email=snapshot.email,
            normalized_email=NormalizedEmail(snapshot.normalized_email) if snapshot.normalized_email else None,
            last_seen_sync_run_id=(
                IMSyncRunId(snapshot.last_seen_sync_run_id) if snapshot.last_seen_sync_run_id else None
            ),
        )
    if not isinstance(snapshot, IMBindingReconciliationSnapshot):
        raise ValueError("IM binding change contains an invalid snapshot")
    return IMBindingChangeSnapshot(
        binding_id=IMBindingId(snapshot.binding_id),
        identity_id=IMIdentityId(snapshot.identity_id),
        contact_id=ContactId(snapshot.contact_id),
    )


def _change_snapshot_to_record(
    snapshot: IMIdentityChangeSnapshot | IMBindingChangeSnapshot | None,
) -> IMIdentityReconciliationSnapshot | IMBindingReconciliationSnapshot | None:
    if snapshot is None:
        return None
    if isinstance(snapshot, IMIdentityChangeSnapshot):
        return IMIdentityReconciliationSnapshot(
            identity_id=str(snapshot.identity_id),
            provider=snapshot.provider,
            provider_user_id=str(snapshot.provider_user_id),
            display_name=snapshot.display_name,
            email=snapshot.email,
            normalized_email=str(snapshot.normalized_email) if snapshot.normalized_email else None,
            last_seen_sync_run_id=(str(snapshot.last_seen_sync_run_id) if snapshot.last_seen_sync_run_id else None),
        )
    return IMBindingReconciliationSnapshot(
        binding_id=str(snapshot.binding_id),
        identity_id=str(snapshot.identity_id),
        contact_id=str(snapshot.contact_id),
    )
