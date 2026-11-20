"""Typed response projections of persisted sync snapshots for Console and Inner APIs."""

from pydantic import NaiveDatetime

from controllers.common.human_input_v2_contracts import (
    HumanInputContactSummary,
    IMDirectoryEntry,
    IMIdentitySnapshot,
    IMSyncResult,
    IMSyncResultAdded,
    IMSyncResultFailed,
    IMSyncResultNotMatched,
    IMSyncResultRemoved,
    IMSyncResultSkipped,
    IMSyncRun,
    IMSyncRunResultCounts,
)
from core.human_input_v2.entities import IMSyncResultType
from core.human_input_v2.im_integration import SyncContactSnapshot, SyncResultFact
from libs.helper import build_avatar_url
from services.human_input_v2.im_contact_sync.service import IMSyncRunSummary


def sync_run_response(summary: IMSyncRunSummary) -> IMSyncRun:
    """Require a persisted summary; return its response model without resolving additional state."""
    run = summary.run
    return IMSyncRun(
        id=run.id,
        status=run.status,
        initiator_display_name=summary.initiator_display_name,
        started_at=run.started_at,
        finished_at=run.finished_at,
        error_message=run.error_message,
        result_counts=IMSyncRunResultCounts(
            added=run.added_count,
            not_matched=run.not_matched_count,
            failed=run.failed_count,
            removed=run.removed_count,
            skipped=run.skipped_count,
        ),
        provider=run.provider,
        channel_id=run.channel_revision.channel_id,
        channel_config_version=run.channel_revision.config_version,
    )


def _directory_entry_response(result: SyncResultFact) -> IMDirectoryEntry | None:
    """Require a persisted result; return its observed entry, or None when no entry was captured."""
    if result.provider_user_id is None:
        return None
    return IMDirectoryEntry(
        provider_user_id=result.provider_user_id,
        display_name=result.display_name,
        email=result.email,
    )


def _sync_contact_response(
    contact: SyncContactSnapshot, fallback_created_at: NaiveDatetime
) -> HumanInputContactSummary:
    """Serialize the frozen Contact profile without consulting current state."""
    # Historical result snapshots predate the Contact creation-time field.
    created_at = contact.created_at if contact.created_at is not None else fallback_created_at
    return HumanInputContactSummary(
        id=contact.contact_id,
        name=contact.name,
        email=contact.email,
        avatar_url=build_avatar_url(contact.avatar_file_id) or "",
        created_at=created_at,
    )


def sync_result_response(result: SyncResultFact) -> IMSyncResult:
    """Require complete persisted snapshots; return the matching DTO or reject missing required facts."""
    entry = _directory_entry_response(result)
    if result.result_type is IMSyncResultType.NOT_MATCHED:
        return IMSyncResultNotMatched(entry=entry)
    if result.result_type is IMSyncResultType.FAILED:
        return IMSyncResultFailed(entry=entry, reason=result.reason_message or result.reason_code or "sync_failed")
    if result.result_type is IMSyncResultType.ADDED:
        if result.contact_snapshot is None or entry is None:
            # TODO(QuantumGhost): this should be an type error.
            raise RuntimeError("added sync result is missing its persisted display snapshot")
        return IMSyncResultAdded(
            contact=_sync_contact_response(result.contact_snapshot, result.created_at),
            entry=entry,
        )
    if result.result_type is IMSyncResultType.SKIPPED:
        if result.contact_snapshot is None:
            # TODO(QuantumGhost): this should be an type error.
            raise RuntimeError("skipped sync result is missing its persisted Contact snapshot")
        return IMSyncResultSkipped(
            entry=entry,
            contact=_sync_contact_response(result.contact_snapshot, result.created_at),
        )
    if result.contact_snapshot is None or result.identity_snapshot is None or result.removal_reason is None:
        # TODO(QuantumGhost): this should be an type error.
        raise RuntimeError("removed sync result is missing its persisted display snapshot")
    return IMSyncResultRemoved(
        contact=_sync_contact_response(result.contact_snapshot, result.created_at),
        last_known_identity=IMIdentitySnapshot(
            identity_id=result.identity_snapshot.identity_id,
            provider_user_id=result.identity_snapshot.provider_user_id,
            display_name=result.identity_snapshot.display_name,
            email=result.identity_snapshot.email,
        ),
        reason=result.removal_reason,
    )
