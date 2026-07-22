"""Persistence contract for KnowledgeFS workspace migration and cutover state."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from models.knowledge_fs_cutover import (
    KnowledgeFSCutoverRevisionWatermark,
    KnowledgeFSCutoverSmokeResults,
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationIssueStatus,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSMigrationQuarantineDisposition,
    KnowledgeFSMigrationQuarantineKind,
    KnowledgeFSShadowAuthorizationDecision,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)


@dataclass(frozen=True, slots=True)
class KnowledgeFSCutoverCASUpdate:
    """Optional values changed with the phase and CAS version in one SQL statement."""

    tenant_id: str
    expected_phase: KnowledgeFSWorkspaceCutoverPhase
    expected_cas_version: int
    new_phase: KnowledgeFSWorkspaceCutoverPhase
    source_revision_watermark: KnowledgeFSCutoverRevisionWatermark | None = None
    final_revision_watermark: KnowledgeFSCutoverRevisionWatermark | None = None
    applied_revision_watermark: KnowledgeFSCutoverRevisionWatermark | None = None
    source_task_watermark: int | None = None
    final_task_watermark: int | None = None
    applied_task_watermark: int | None = None
    shadow_started_at: datetime | None = None
    shadow_completed_at: datetime | None = None
    shadow_evidence_digest: str | None = None
    shadow_observation_count: int | None = None
    shadow_window_started_at: datetime | None = None
    shadow_window_ended_at: datetime | None = None
    shadow_traffic_zero: bool | None = None
    shadow_traffic_zero_evidence: dict[str, object] | None = None
    shadow_latest_observed_revision: KnowledgeFSCutoverRevisionWatermark | None = None
    shadow_producer: str | None = None
    shadow_completed_by_operator: str | None = None
    shadow_completed_by_account_id: str | None = None
    remote_freeze_id: str | None = None
    remote_freeze_revision: int | None = None
    remote_freeze_digest: str | None = None
    remote_freeze_task_watermark: int | None = None
    remote_freeze_control_space_id: str | None = None
    remote_freeze_frozen_at: datetime | None = None
    remote_freeze_updated_at: datetime | None = None
    remote_freeze_acknowledged_at: datetime | None = None
    remote_freeze_applied: bool | None = None
    remote_freeze_replayed: bool | None = None
    remote_activation_id: str | None = None
    remote_activation_revision: int | None = None
    remote_activation_digest: str | None = None
    remote_activation_control_space_id: str | None = None
    remote_activation_activated_at: datetime | None = None
    remote_activation_updated_at: datetime | None = None
    remote_activation_acknowledged_at: datetime | None = None
    remote_activation_applied: bool | None = None
    remote_activation_replayed: bool | None = None
    clear_smoke_results: bool = False
    freeze_at: datetime | None = None
    cutover_at: datetime | None = None
    rolled_back_at: datetime | None = None
    rollback_cutoff_at: datetime | None = None
    observation_started_at: datetime | None = None
    observation_window_ends_at: datetime | None = None
    observation_completed_at: datetime | None = None
    maximum_task_expires_at: datetime | None = None
    irreversible_cleanup_at: datetime | None = None
    smoke_results: KnowledgeFSCutoverSmokeResults | None = None
    legacy_dependency_report: list[dict[str, object]] | None = None
    legacy_dependency_checked_at: datetime | None = None
    legacy_dependency_ready: bool | None = None
    product_routes_enabled: bool | None = None
    capability_v2_enabled: bool | None = None
    integrated_mode_enabled: bool | None = None
    legacy_acl_read_only: bool | None = None


@dataclass(frozen=True, slots=True)
class KnowledgeFSQuarantineCASUpdate:
    """Tenant/item-scoped transition from an operator disposition to resolved."""

    tenant_id: str
    ledger_id: str
    source_kind: KnowledgeFSMigrationQuarantineKind
    source_id: str
    expected_disposition: KnowledgeFSMigrationQuarantineDisposition
    expected_row_version: int
    resolved_by_operator: str
    resolved_by_account_id: str
    evidence: dict[str, object]
    resolved_at: datetime


@dataclass(frozen=True, slots=True)
class KnowledgeFSShadowDiffCASUpdate:
    """Replace one current diff disposition after append-only safe re-evaluation."""

    tenant_id: str
    ledger_id: str
    diff_key: str
    expected_row_version: int
    control_space_id: str | None
    principal: str
    legacy_allowed: bool | None
    dify_allowed: bool
    decision: KnowledgeFSShadowAuthorizationDecision
    reason: str
    observed_revision: KnowledgeFSCutoverRevisionWatermark
    status: KnowledgeFSMigrationIssueStatus
    current_evidence_digest: str
    last_observed_at: datetime


class KnowledgeFSCutoverRepository(Protocol):
    """Tenant-scoped storage; callers own the surrounding transaction."""

    def add_ledger(self, ledger: KnowledgeFSWorkspaceCutoverLedger) -> KnowledgeFSWorkspaceCutoverLedger: ...

    def get_ledger(self, *, tenant_id: str) -> KnowledgeFSWorkspaceCutoverLedger | None: ...

    def list_ledgers(self) -> tuple[KnowledgeFSWorkspaceCutoverLedger, ...]: ...

    def compare_and_set(self, update_values: KnowledgeFSCutoverCASUpdate) -> bool: ...

    def add_issue(self, issue: KnowledgeFSMigrationIssue) -> KnowledgeFSMigrationIssue: ...

    def get_issue(self, *, tenant_id: str, ledger_id: str, issue_key: str) -> KnowledgeFSMigrationIssue | None: ...

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
    ) -> bool: ...

    def add_quarantine(self, item: KnowledgeFSMigrationQuarantine) -> KnowledgeFSMigrationQuarantine: ...

    def get_quarantine(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        source_kind: KnowledgeFSMigrationQuarantineKind,
        source_id: str,
    ) -> KnowledgeFSMigrationQuarantine | None: ...

    def resolve_quarantine(self, update_values: KnowledgeFSQuarantineCASUpdate) -> bool: ...

    def add_shadow_diff(self, diff: KnowledgeFSShadowAuthorizationDiff) -> KnowledgeFSShadowAuthorizationDiff: ...

    def get_shadow_diff(
        self, *, tenant_id: str, ledger_id: str, diff_key: str
    ) -> KnowledgeFSShadowAuthorizationDiff | None: ...

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
    ) -> bool: ...

    def reevaluate_shadow_diff(self, update_values: KnowledgeFSShadowDiffCASUpdate) -> bool: ...

    def add_shadow_observation(
        self, observation: KnowledgeFSShadowAuthorizationObservation
    ) -> KnowledgeFSShadowAuthorizationObservation: ...

    def get_shadow_observation(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        diff_key: str,
        evidence_digest: str,
    ) -> KnowledgeFSShadowAuthorizationObservation | None: ...

    def count_open_issues(self, *, tenant_id: str, ledger_id: str) -> int: ...

    def count_unapproved_shadow_diffs(self, *, tenant_id: str, ledger_id: str) -> int: ...

    def count_unresolved_quarantine(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        source_kinds: tuple[KnowledgeFSMigrationQuarantineKind, ...],
    ) -> int: ...

    def list_issues(self, *, tenant_id: str, ledger_id: str) -> tuple[KnowledgeFSMigrationIssue, ...]: ...

    def list_quarantine(self, *, tenant_id: str, ledger_id: str) -> tuple[KnowledgeFSMigrationQuarantine, ...]: ...

    def list_shadow_diffs(
        self, *, tenant_id: str, ledger_id: str
    ) -> tuple[KnowledgeFSShadowAuthorizationDiff, ...]: ...

    def list_shadow_observations(
        self, *, tenant_id: str, ledger_id: str
    ) -> tuple[KnowledgeFSShadowAuthorizationObservation, ...]: ...


__all__ = [
    "KnowledgeFSCutoverCASUpdate",
    "KnowledgeFSCutoverRepository",
    "KnowledgeFSQuarantineCASUpdate",
    "KnowledgeFSShadowDiffCASUpdate",
]
