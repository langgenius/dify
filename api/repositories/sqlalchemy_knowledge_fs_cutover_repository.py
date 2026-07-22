"""SQLAlchemy repository for the KnowledgeFS workspace cutover ledger."""

from __future__ import annotations

from datetime import datetime
from typing import cast, override

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationIssueStatus,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSMigrationQuarantineDisposition,
    KnowledgeFSMigrationQuarantineKind,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
)
from repositories.knowledge_fs_cutover_repository import (
    KnowledgeFSCutoverCASUpdate,
    KnowledgeFSCutoverRepository,
    KnowledgeFSQuarantineCASUpdate,
    KnowledgeFSShadowDiffCASUpdate,
)


class SQLAlchemyKnowledgeFSCutoverRepository(KnowledgeFSCutoverRepository):
    """Persist one tenant ledger and evidence using tenant-scoped queries and CAS writes."""

    _session: Session

    def __init__(self, session: Session):
        self._session = session

    @override
    def add_ledger(self, ledger: KnowledgeFSWorkspaceCutoverLedger) -> KnowledgeFSWorkspaceCutoverLedger:
        self._session.add(ledger)
        self._session.flush()
        return ledger

    @override
    def get_ledger(self, *, tenant_id: str) -> KnowledgeFSWorkspaceCutoverLedger | None:
        statement = (
            select(KnowledgeFSWorkspaceCutoverLedger)
            .where(KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id)
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def list_ledgers(self) -> tuple[KnowledgeFSWorkspaceCutoverLedger, ...]:
        statement = select(KnowledgeFSWorkspaceCutoverLedger).order_by(KnowledgeFSWorkspaceCutoverLedger.tenant_id)
        return tuple(self._session.scalars(statement).all())

    @override
    def compare_and_set(self, update_values: KnowledgeFSCutoverCASUpdate) -> bool:
        values: dict[str, object] = {
            "phase": update_values.new_phase,
            "cas_version": KnowledgeFSWorkspaceCutoverLedger.cas_version + 1,
        }
        for field_name in (
            "source_revision_watermark",
            "final_revision_watermark",
            "applied_revision_watermark",
            "source_task_watermark",
            "final_task_watermark",
            "applied_task_watermark",
            "shadow_started_at",
            "shadow_completed_at",
            "shadow_evidence_digest",
            "shadow_observation_count",
            "shadow_window_started_at",
            "shadow_window_ended_at",
            "shadow_traffic_zero",
            "shadow_traffic_zero_evidence",
            "shadow_latest_observed_revision",
            "shadow_producer",
            "shadow_completed_by_operator",
            "shadow_completed_by_account_id",
            "remote_freeze_id",
            "remote_freeze_revision",
            "remote_freeze_digest",
            "remote_freeze_task_watermark",
            "remote_freeze_control_space_id",
            "remote_freeze_frozen_at",
            "remote_freeze_updated_at",
            "remote_freeze_acknowledged_at",
            "remote_freeze_applied",
            "remote_freeze_replayed",
            "remote_activation_id",
            "remote_activation_revision",
            "remote_activation_digest",
            "remote_activation_control_space_id",
            "remote_activation_activated_at",
            "remote_activation_updated_at",
            "remote_activation_acknowledged_at",
            "remote_activation_applied",
            "remote_activation_replayed",
            "freeze_at",
            "cutover_at",
            "rolled_back_at",
            "rollback_cutoff_at",
            "observation_started_at",
            "observation_window_ends_at",
            "observation_completed_at",
            "maximum_task_expires_at",
            "irreversible_cleanup_at",
            "smoke_results",
            "legacy_dependency_report",
            "legacy_dependency_checked_at",
            "legacy_dependency_ready",
            "product_routes_enabled",
            "capability_v2_enabled",
            "integrated_mode_enabled",
            "legacy_acl_read_only",
        ):
            value = getattr(update_values, field_name)
            if value is not None:
                values[field_name] = value
        if update_values.clear_smoke_results:
            values["smoke_results"] = None
        statement = (
            update(KnowledgeFSWorkspaceCutoverLedger)
            .where(
                KnowledgeFSWorkspaceCutoverLedger.tenant_id == update_values.tenant_id,
                KnowledgeFSWorkspaceCutoverLedger.phase == update_values.expected_phase,
                KnowledgeFSWorkspaceCutoverLedger.cas_version == update_values.expected_cas_version,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def add_issue(self, issue: KnowledgeFSMigrationIssue) -> KnowledgeFSMigrationIssue:
        self._session.add(issue)
        self._session.flush()
        return issue

    @override
    def get_issue(self, *, tenant_id: str, ledger_id: str, issue_key: str) -> KnowledgeFSMigrationIssue | None:
        statement = select(KnowledgeFSMigrationIssue).where(
            KnowledgeFSMigrationIssue.tenant_id == tenant_id,
            KnowledgeFSMigrationIssue.ledger_id == ledger_id,
            KnowledgeFSMigrationIssue.issue_key == issue_key,
        )
        return self._session.scalar(statement)

    @override
    def set_issue_status(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        issue_key: str,
        expected_status: KnowledgeFSMigrationIssueStatus,
        new_status: KnowledgeFSMigrationIssueStatus,
        account_id: str,
        changed_at: datetime,
    ) -> bool:
        values: dict[str, object] = {"status": new_status}
        if new_status is KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED:
            values.update(approved_at=changed_at, approved_by_account_id=account_id)
        elif new_status is KnowledgeFSMigrationIssueStatus.RESOLVED:
            values.update(resolved_at=changed_at, resolved_by_account_id=account_id)
        statement = (
            update(KnowledgeFSMigrationIssue)
            .where(
                KnowledgeFSMigrationIssue.tenant_id == tenant_id,
                KnowledgeFSMigrationIssue.ledger_id == ledger_id,
                KnowledgeFSMigrationIssue.issue_key == issue_key,
                KnowledgeFSMigrationIssue.status == expected_status,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def reevaluate_shadow_diff(self, update_values: KnowledgeFSShadowDiffCASUpdate) -> bool:
        statement = (
            update(KnowledgeFSShadowAuthorizationDiff)
            .where(
                KnowledgeFSShadowAuthorizationDiff.tenant_id == update_values.tenant_id,
                KnowledgeFSShadowAuthorizationDiff.ledger_id == update_values.ledger_id,
                KnowledgeFSShadowAuthorizationDiff.diff_key == update_values.diff_key,
                KnowledgeFSShadowAuthorizationDiff.row_version == update_values.expected_row_version,
            )
            .values(
                control_space_id=update_values.control_space_id,
                principal=update_values.principal,
                legacy_allowed=update_values.legacy_allowed,
                dify_allowed=update_values.dify_allowed,
                decision=update_values.decision,
                reason=update_values.reason,
                observed_revision=update_values.observed_revision,
                status=update_values.status,
                current_evidence_digest=update_values.current_evidence_digest,
                last_observed_at=update_values.last_observed_at,
                approved_by_account_id=None,
                approved_at=None,
                resolved_by_account_id=None,
                resolved_at=update_values.last_observed_at,
                row_version=KnowledgeFSShadowAuthorizationDiff.row_version + 1,
            )
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def add_shadow_observation(
        self, observation: KnowledgeFSShadowAuthorizationObservation
    ) -> KnowledgeFSShadowAuthorizationObservation:
        self._session.add(observation)
        self._session.flush()
        return observation

    @override
    def get_shadow_observation(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        diff_key: str,
        evidence_digest: str,
    ) -> KnowledgeFSShadowAuthorizationObservation | None:
        statement = select(KnowledgeFSShadowAuthorizationObservation).where(
            KnowledgeFSShadowAuthorizationObservation.tenant_id == tenant_id,
            KnowledgeFSShadowAuthorizationObservation.ledger_id == ledger_id,
            KnowledgeFSShadowAuthorizationObservation.diff_key == diff_key,
            KnowledgeFSShadowAuthorizationObservation.evidence_digest == evidence_digest,
        )
        return self._session.scalar(statement)

    @override
    def add_quarantine(self, item: KnowledgeFSMigrationQuarantine) -> KnowledgeFSMigrationQuarantine:
        self._session.add(item)
        self._session.flush()
        return item

    @override
    def get_quarantine(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        source_kind: KnowledgeFSMigrationQuarantineKind,
        source_id: str,
    ) -> KnowledgeFSMigrationQuarantine | None:
        statement = select(KnowledgeFSMigrationQuarantine).where(
            KnowledgeFSMigrationQuarantine.tenant_id == tenant_id,
            KnowledgeFSMigrationQuarantine.ledger_id == ledger_id,
            KnowledgeFSMigrationQuarantine.source_kind == source_kind,
            KnowledgeFSMigrationQuarantine.source_id == source_id,
        )
        return self._session.scalar(statement)

    @override
    def resolve_quarantine(self, update_values: KnowledgeFSQuarantineCASUpdate) -> bool:
        statement = (
            update(KnowledgeFSMigrationQuarantine)
            .where(
                KnowledgeFSMigrationQuarantine.tenant_id == update_values.tenant_id,
                KnowledgeFSMigrationQuarantine.ledger_id == update_values.ledger_id,
                KnowledgeFSMigrationQuarantine.source_kind == update_values.source_kind,
                KnowledgeFSMigrationQuarantine.source_id == update_values.source_id,
                KnowledgeFSMigrationQuarantine.disposition == update_values.expected_disposition,
                KnowledgeFSMigrationQuarantine.row_version == update_values.expected_row_version,
            )
            .values(
                disposition=KnowledgeFSMigrationQuarantineDisposition.RESOLVED,
                resolved_by_operator=update_values.resolved_by_operator,
                resolved_by_account_id=update_values.resolved_by_account_id,
                evidence=update_values.evidence,
                resolved_at=update_values.resolved_at,
                row_version=KnowledgeFSMigrationQuarantine.row_version + 1,
            )
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def add_shadow_diff(self, diff: KnowledgeFSShadowAuthorizationDiff) -> KnowledgeFSShadowAuthorizationDiff:
        self._session.add(diff)
        self._session.flush()
        return diff

    @override
    def get_shadow_diff(
        self, *, tenant_id: str, ledger_id: str, diff_key: str
    ) -> KnowledgeFSShadowAuthorizationDiff | None:
        statement = select(KnowledgeFSShadowAuthorizationDiff).where(
            KnowledgeFSShadowAuthorizationDiff.tenant_id == tenant_id,
            KnowledgeFSShadowAuthorizationDiff.ledger_id == ledger_id,
            KnowledgeFSShadowAuthorizationDiff.diff_key == diff_key,
        )
        return self._session.scalar(statement)

    @override
    def set_shadow_diff_status(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        diff_key: str,
        expected_status: KnowledgeFSMigrationIssueStatus,
        new_status: KnowledgeFSMigrationIssueStatus,
        account_id: str,
        changed_at: datetime,
    ) -> bool:
        values: dict[str, object] = {
            "status": new_status,
            "row_version": KnowledgeFSShadowAuthorizationDiff.row_version + 1,
        }
        if new_status is KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED:
            values.update(approved_at=changed_at, approved_by_account_id=account_id)
        elif new_status is KnowledgeFSMigrationIssueStatus.RESOLVED:
            values.update(resolved_at=changed_at, resolved_by_account_id=account_id)
        statement = (
            update(KnowledgeFSShadowAuthorizationDiff)
            .where(
                KnowledgeFSShadowAuthorizationDiff.tenant_id == tenant_id,
                KnowledgeFSShadowAuthorizationDiff.ledger_id == ledger_id,
                KnowledgeFSShadowAuthorizationDiff.diff_key == diff_key,
                KnowledgeFSShadowAuthorizationDiff.status == expected_status,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def count_open_issues(self, *, tenant_id: str, ledger_id: str) -> int:
        statement = (
            select(func.count())
            .select_from(KnowledgeFSMigrationIssue)
            .where(
                KnowledgeFSMigrationIssue.tenant_id == tenant_id,
                KnowledgeFSMigrationIssue.ledger_id == ledger_id,
                KnowledgeFSMigrationIssue.status == KnowledgeFSMigrationIssueStatus.OPEN,
            )
        )
        return self._session.scalar(statement) or 0

    @override
    def count_unapproved_shadow_diffs(self, *, tenant_id: str, ledger_id: str) -> int:
        statement = (
            select(func.count())
            .select_from(KnowledgeFSShadowAuthorizationDiff)
            .where(
                KnowledgeFSShadowAuthorizationDiff.tenant_id == tenant_id,
                KnowledgeFSShadowAuthorizationDiff.ledger_id == ledger_id,
                KnowledgeFSShadowAuthorizationDiff.status == KnowledgeFSMigrationIssueStatus.OPEN,
            )
        )
        return self._session.scalar(statement) or 0

    @override
    def count_unresolved_quarantine(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        source_kinds: tuple[KnowledgeFSMigrationQuarantineKind, ...],
    ) -> int:
        if not source_kinds:
            return 0
        statement = (
            select(func.count())
            .select_from(KnowledgeFSMigrationQuarantine)
            .where(
                KnowledgeFSMigrationQuarantine.tenant_id == tenant_id,
                KnowledgeFSMigrationQuarantine.ledger_id == ledger_id,
                KnowledgeFSMigrationQuarantine.source_kind.in_(source_kinds),
                KnowledgeFSMigrationQuarantine.disposition != KnowledgeFSMigrationQuarantineDisposition.RESOLVED,
            )
        )
        return self._session.scalar(statement) or 0

    @override
    def list_issues(self, *, tenant_id: str, ledger_id: str) -> tuple[KnowledgeFSMigrationIssue, ...]:
        statement = (
            select(KnowledgeFSMigrationIssue)
            .where(
                KnowledgeFSMigrationIssue.tenant_id == tenant_id,
                KnowledgeFSMigrationIssue.ledger_id == ledger_id,
            )
            .order_by(KnowledgeFSMigrationIssue.created_at, KnowledgeFSMigrationIssue.id)
        )
        return tuple(self._session.scalars(statement).all())

    @override
    def list_quarantine(self, *, tenant_id: str, ledger_id: str) -> tuple[KnowledgeFSMigrationQuarantine, ...]:
        statement = (
            select(KnowledgeFSMigrationQuarantine)
            .where(
                KnowledgeFSMigrationQuarantine.tenant_id == tenant_id,
                KnowledgeFSMigrationQuarantine.ledger_id == ledger_id,
            )
            .order_by(KnowledgeFSMigrationQuarantine.created_at, KnowledgeFSMigrationQuarantine.id)
        )
        return tuple(self._session.scalars(statement).all())

    @override
    def list_shadow_diffs(self, *, tenant_id: str, ledger_id: str) -> tuple[KnowledgeFSShadowAuthorizationDiff, ...]:
        statement = (
            select(KnowledgeFSShadowAuthorizationDiff)
            .where(
                KnowledgeFSShadowAuthorizationDiff.tenant_id == tenant_id,
                KnowledgeFSShadowAuthorizationDiff.ledger_id == ledger_id,
            )
            .order_by(KnowledgeFSShadowAuthorizationDiff.created_at, KnowledgeFSShadowAuthorizationDiff.id)
        )
        return tuple(self._session.scalars(statement).all())

    @override
    def list_shadow_observations(
        self, *, tenant_id: str, ledger_id: str
    ) -> tuple[KnowledgeFSShadowAuthorizationObservation, ...]:
        statement = (
            select(KnowledgeFSShadowAuthorizationObservation)
            .where(
                KnowledgeFSShadowAuthorizationObservation.tenant_id == tenant_id,
                KnowledgeFSShadowAuthorizationObservation.ledger_id == ledger_id,
            )
            .order_by(
                KnowledgeFSShadowAuthorizationObservation.observed_at,
                KnowledgeFSShadowAuthorizationObservation.evidence_digest,
            )
        )
        return tuple(self._session.scalars(statement).all())


__all__ = ["SQLAlchemyKnowledgeFSCutoverRepository"]
