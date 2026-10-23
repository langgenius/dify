"""Workspace-scoped KnowledgeFS migration and cutover persistence.

The ledger is Dify control-plane state only. It deliberately stores opaque
KnowledgeFS identifiers and authorization watermarks without foreign keys or
queries to legacy product tables. Cutover feature switches live on one
row so the repository can change them with a single CAS statement. Quarantine
remediation is separately CAS-versioned and retains immutable operator evidence.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TypedDict

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID


class KnowledgeFSCutoverRevisionWatermark(TypedDict):
    membership_epoch: int
    space_acl_epoch: int
    external_access_epoch: int
    content_policy_revision: int


class KnowledgeFSCutoverSmokeChecks(TypedDict):
    authorization: bool
    list_spaces: bool
    create_space: bool
    query: bool
    upload: bool
    stream: bool
    deletion: bool


class KnowledgeFSCutoverSmokeEvidenceReferences(TypedDict):
    authorization: str
    list_spaces: str
    create_space: str
    query: str
    upload: str
    stream: str
    deletion: str


class KnowledgeFSCutoverSmokeResults(TypedDict):
    schema_version: str
    tenant_id: str
    environment: str
    operator: str
    operator_account_id: str
    observed_at: str
    checks: KnowledgeFSCutoverSmokeChecks
    evidence_references: KnowledgeFSCutoverSmokeEvidenceReferences


def knowledge_fs_cutover_smoke_results_passed(value: KnowledgeFSCutoverSmokeResults | None) -> bool:
    """Reject incomplete or pre-production JSON evidence instead of treating metadata as booleans."""

    if not isinstance(value, dict):
        return False
    checks = value.get("checks")
    references = value.get("evidence_references")
    expected = {
        "authorization",
        "list_spaces",
        "create_space",
        "query",
        "upload",
        "stream",
        "deletion",
    }
    return bool(
        value.get("schema_version") == "knowledge-fs-p8-cutover-smoke/v1"
        and value.get("environment") == "production"
        and isinstance(checks, dict)
        and set(checks) == expected
        and all(checks.get(name) is True for name in expected)
        and isinstance(references, dict)
        and set(references) == expected
        and all(isinstance(reference := references.get(name), str) and bool(reference) for name in expected)
    )


class KnowledgeFSWorkspaceCutoverPhase(StrEnum):
    INVENTORY = "inventory"
    BACKFILL = "backfill"
    SHADOW = "shadow"
    FROZEN = "frozen"
    CUTOVER = "cutover"
    OBSERVING = "observing"
    READY_FOR_CLEANUP = "ready_for_cleanup"


class KnowledgeFSMigrationIssueStatus(StrEnum):
    OPEN = "open"
    APPROVED_FAIL_CLOSED = "approved_fail_closed"
    RESOLVED = "resolved"


class KnowledgeFSMigrationIssueKind(StrEnum):
    REGISTRATION_CONFLICT = "registration_conflict"
    UNRESOLVED_SUBJECT = "unresolved_subject"
    UNKNOWN_EXTERNAL_ACCESS = "unknown_external_access"
    REVISION_DRIFT = "revision_drift"
    TASK_QUARANTINE = "task_quarantine"
    LEGACY_SNAPSHOT_DEPENDENCY = "legacy_snapshot_dependency"
    LEGACY_FOREIGN_KEY_DEPENDENCY = "legacy_foreign_key_dependency"


class KnowledgeFSMigrationQuarantineKind(StrEnum):
    CONTROL_SPACE = "control_space"
    SUBJECT = "subject"
    TASK = "task"
    LEGACY_API_KEY = "legacy_api_key"
    ORPHAN_RESOURCE = "orphan_resource"


class KnowledgeFSMigrationQuarantineDisposition(StrEnum):
    PENDING = "pending"
    MIGRATABLE = "migratable"
    WAIT_FOR_COMPLETION = "wait_for_completion"
    CANCEL = "cancel"
    ISOLATE = "isolate"
    ROTATE_CREDENTIAL = "rotate_credential"
    RESOLVED = "resolved"


class KnowledgeFSShadowAuthorizationDecision(StrEnum):
    MATCH = "match"
    TIGHTENED = "tightened"
    EXPANDED = "expanded"
    UNKNOWN = "unknown"


class KnowledgeFSWorkspaceCutoverLedger(DefaultFieldsDCMixin, TypeBase):
    """Single-Workspace migration state, watermarks, switches, and time fences."""

    __tablename__ = "knowledge_fs_workspace_cutover_ledgers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_workspace_cutover_ledger_pkey"),
        UniqueConstraint("tenant_id", name="kfs_workspace_cutover_ledger_tenant_uq"),
        UniqueConstraint("tenant_id", "id", name="kfs_workspace_cutover_ledger_tenant_id_uq"),
        Index("kfs_workspace_cutover_ledger_phase_updated_idx", "phase", "updated_at"),
        sa.CheckConstraint("cas_version >= 0", name=sa.schema.conv("kfs_workspace_cutover_cas_version_ck")),
        sa.CheckConstraint(
            "source_task_watermark >= 0 AND applied_task_watermark >= 0 "
            "AND (final_task_watermark IS NULL OR final_task_watermark >= 0)",
            name=sa.schema.conv("kfs_workspace_cutover_task_watermark_ck"),
        ),
        sa.CheckConstraint(
            "cutover_at IS NULL OR freeze_at IS NOT NULL",
            name=sa.schema.conv("kfs_workspace_cutover_freeze_before_cutover_ck"),
        ),
        sa.CheckConstraint(
            "rollback_cutoff_at IS NULL OR cutover_at IS NOT NULL",
            name=sa.schema.conv("kfs_workspace_cutover_rollback_cutoff_ck"),
        ),
        sa.CheckConstraint(
            "shadow_observation_count >= 0",
            name=sa.schema.conv("kfs_workspace_cutover_shadow_count_ck"),
        ),
        sa.CheckConstraint(
            "shadow_window_ended_at IS NULL OR shadow_window_started_at IS NOT NULL",
            name=sa.schema.conv("kfs_workspace_cutover_shadow_window_ck"),
        ),
        sa.CheckConstraint(
            "(shadow_completed_at IS NULL "
            "AND shadow_evidence_digest IS NULL AND shadow_producer IS NULL "
            "AND shadow_completed_by_operator IS NULL AND shadow_completed_by_account_id IS NULL "
            "AND shadow_window_started_at IS NULL AND shadow_window_ended_at IS NULL "
            "AND shadow_traffic_zero = false AND shadow_traffic_zero_evidence IS NULL "
            "AND shadow_latest_observed_revision IS NULL) OR "
            "(shadow_completed_at IS NOT NULL AND shadow_started_at IS NOT NULL "
            "AND shadow_evidence_digest IS NOT NULL AND shadow_producer IS NOT NULL "
            "AND shadow_completed_by_operator IS NOT NULL AND shadow_completed_by_account_id IS NOT NULL "
            "AND ((shadow_traffic_zero = true AND shadow_observation_count = 0 "
            "AND shadow_traffic_zero_evidence IS NOT NULL AND shadow_window_started_at IS NULL "
            "AND shadow_window_ended_at IS NULL AND shadow_latest_observed_revision IS NULL) OR "
            "(shadow_traffic_zero = false AND shadow_observation_count > 0 "
            "AND shadow_traffic_zero_evidence IS NULL AND shadow_window_started_at IS NOT NULL "
            "AND shadow_window_ended_at IS NOT NULL AND shadow_latest_observed_revision IS NOT NULL)))",
            name=sa.schema.conv("kfs_workspace_cutover_shadow_completion_fields_ck"),
        ),
        sa.CheckConstraint(
            "(remote_freeze_id IS NULL AND remote_freeze_revision IS NULL "
            "AND remote_freeze_digest IS NULL AND remote_freeze_task_watermark IS NULL "
            "AND remote_freeze_control_space_id IS NULL AND remote_freeze_frozen_at IS NULL "
            "AND remote_freeze_updated_at IS NULL AND remote_freeze_acknowledged_at IS NULL "
            "AND remote_freeze_applied IS NULL AND remote_freeze_replayed IS NULL) OR "
            "(remote_freeze_id IS NOT NULL AND remote_freeze_revision BETWEEN 1 AND 9007199254740991 "
            "AND remote_freeze_digest IS NOT NULL AND remote_freeze_task_watermark >= 0 "
            "AND remote_freeze_control_space_id IS NOT NULL AND remote_freeze_frozen_at IS NOT NULL "
            "AND remote_freeze_updated_at IS NOT NULL AND remote_freeze_acknowledged_at IS NOT NULL "
            "AND ((remote_freeze_applied = true AND remote_freeze_replayed = false) "
            "OR (remote_freeze_applied = false AND remote_freeze_replayed = true)))",
            name=sa.schema.conv("kfs_workspace_cutover_remote_freeze_fields_ck"),
        ),
        sa.CheckConstraint(
            "remote_freeze_updated_at IS NULL OR remote_freeze_updated_at >= remote_freeze_frozen_at",
            name=sa.schema.conv("kfs_workspace_cutover_remote_freeze_time_ck"),
        ),
        sa.CheckConstraint(
            "(remote_activation_id IS NULL AND remote_activation_revision IS NULL "
            "AND remote_activation_digest IS NULL AND remote_activation_control_space_id IS NULL "
            "AND remote_activation_activated_at IS NULL AND remote_activation_updated_at IS NULL "
            "AND remote_activation_acknowledged_at IS NULL AND remote_activation_applied IS NULL "
            "AND remote_activation_replayed IS NULL) OR "
            "(remote_activation_id IS NOT NULL AND remote_activation_revision BETWEEN 1 AND 9007199254740991 "
            "AND remote_activation_digest IS NOT NULL AND remote_activation_control_space_id IS NOT NULL "
            "AND remote_activation_activated_at IS NOT NULL AND remote_activation_updated_at IS NOT NULL "
            "AND remote_activation_acknowledged_at IS NOT NULL "
            "AND ((remote_activation_applied = true AND remote_activation_replayed = false) "
            "OR (remote_activation_applied = false AND remote_activation_replayed = true)))",
            name=sa.schema.conv("kfs_workspace_cutover_remote_activation_fields_ck"),
        ),
        sa.CheckConstraint(
            "remote_activation_updated_at IS NULL OR remote_activation_updated_at >= remote_activation_activated_at",
            name=sa.schema.conv("kfs_workspace_cutover_remote_activation_time_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source_revision_watermark: Mapped[KnowledgeFSCutoverRevisionWatermark] = mapped_column(sa.JSON, nullable=False)
    applied_revision_watermark: Mapped[KnowledgeFSCutoverRevisionWatermark] = mapped_column(sa.JSON, nullable=False)
    phase: Mapped[KnowledgeFSWorkspaceCutoverPhase] = mapped_column(
        EnumText(KnowledgeFSWorkspaceCutoverPhase, length=32),
        nullable=False,
        server_default=sa.text("'inventory'"),
        default=KnowledgeFSWorkspaceCutoverPhase.INVENTORY,
    )
    final_revision_watermark: Mapped[KnowledgeFSCutoverRevisionWatermark | None] = mapped_column(
        sa.JSON, nullable=True, default=None
    )
    source_task_watermark: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0
    )
    final_task_watermark: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    applied_task_watermark: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0
    )
    shadow_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    shadow_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    shadow_evidence_digest: Mapped[str | None] = mapped_column(String(71), nullable=True, default=None)
    shadow_observation_count: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0
    )
    shadow_window_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    shadow_window_ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    shadow_traffic_zero: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    shadow_traffic_zero_evidence: Mapped[dict[str, object] | None] = mapped_column(
        sa.JSON(none_as_null=True), nullable=True, default=None
    )
    shadow_latest_observed_revision: Mapped[KnowledgeFSCutoverRevisionWatermark | None] = mapped_column(
        sa.JSON(none_as_null=True), nullable=True, default=None
    )
    shadow_producer: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    shadow_completed_by_operator: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    shadow_completed_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    remote_freeze_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    remote_freeze_revision: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    remote_freeze_digest: Mapped[str | None] = mapped_column(String(71), nullable=True, default=None)
    remote_freeze_task_watermark: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    remote_freeze_control_space_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    remote_freeze_frozen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_freeze_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_freeze_acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_freeze_applied: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)
    remote_freeze_replayed: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)
    remote_activation_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    remote_activation_revision: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    remote_activation_digest: Mapped[str | None] = mapped_column(String(71), nullable=True, default=None)
    remote_activation_control_space_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    remote_activation_activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_activation_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_activation_acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    remote_activation_applied: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)
    remote_activation_replayed: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)
    freeze_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    cutover_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    rollback_cutoff_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    observation_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    observation_window_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    observation_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    maximum_task_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    irreversible_cleanup_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    product_routes_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    capability_v2_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    integrated_mode_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    legacy_acl_read_only: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    smoke_results: Mapped[KnowledgeFSCutoverSmokeResults | None] = mapped_column(sa.JSON, nullable=True, default=None)
    legacy_dependency_report: Mapped[list[dict[str, object]] | None] = mapped_column(
        sa.JSON, nullable=True, default=None
    )
    legacy_dependency_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    legacy_dependency_ready: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    cas_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


class KnowledgeFSMigrationIssue(DefaultFieldsDCMixin, TypeBase):
    """Auditable blocker; unknown access can only be approved as fail-closed."""

    __tablename__ = "knowledge_fs_migration_issues"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_migration_issue_pkey"),
        UniqueConstraint("tenant_id", "ledger_id", "issue_key", name="kfs_migration_issue_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_migration_issue_ledger_fk",
            ondelete="CASCADE",
        ),
        Index("kfs_migration_issue_gate_idx", "tenant_id", "ledger_id", "status", "kind"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    ledger_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    issue_key: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[KnowledgeFSMigrationIssueKind] = mapped_column(
        EnumText(KnowledgeFSMigrationIssueKind, length=48), nullable=False
    )
    status: Mapped[KnowledgeFSMigrationIssueStatus] = mapped_column(
        EnumText(KnowledgeFSMigrationIssueStatus, length=32),
        nullable=False,
        server_default=sa.text("'open'"),
        default=KnowledgeFSMigrationIssueStatus.OPEN,
    )
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    details: Mapped[dict[str, object]] = mapped_column(sa.JSON, nullable=False, default_factory=dict)
    approved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    resolved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)


class KnowledgeFSMigrationQuarantine(DefaultFieldsDCMixin, TypeBase):
    """Fail-closed inventory item whose operator resolution is immutable and CAS-versioned."""

    __tablename__ = "knowledge_fs_migration_quarantine"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_migration_quarantine_pkey"),
        UniqueConstraint(
            "tenant_id",
            "ledger_id",
            "source_kind",
            "source_id",
            name="kfs_migration_quarantine_source_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_migration_quarantine_ledger_fk",
            ondelete="CASCADE",
        ),
        Index("kfs_migration_quarantine_disposition_idx", "tenant_id", "ledger_id", "disposition"),
        sa.CheckConstraint("row_version >= 0", name=sa.schema.conv("kfs_migration_quarantine_version_ck")),
        sa.CheckConstraint(
            "(disposition = 'resolved' "
            "AND resolved_by_operator IS NOT NULL AND resolved_by_account_id IS NOT NULL "
            "AND evidence IS NOT NULL AND resolved_at IS NOT NULL) OR "
            "(disposition <> 'resolved' "
            "AND resolved_by_operator IS NULL AND resolved_by_account_id IS NULL "
            "AND evidence IS NULL AND resolved_at IS NULL)",
            name=sa.schema.conv("kfs_migration_quarantine_resolution_fields_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    ledger_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source_kind: Mapped[KnowledgeFSMigrationQuarantineKind] = mapped_column(
        EnumText(KnowledgeFSMigrationQuarantineKind, length=32), nullable=False
    )
    source_id: Mapped[str] = mapped_column(String(255), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    disposition: Mapped[KnowledgeFSMigrationQuarantineDisposition] = mapped_column(
        EnumText(KnowledgeFSMigrationQuarantineDisposition, length=32), nullable=False
    )
    details: Mapped[dict[str, object]] = mapped_column(sa.JSON, nullable=False, default_factory=dict)
    resolved_by_operator: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    resolved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    evidence: Mapped[dict[str, object] | None] = mapped_column(sa.JSON(none_as_null=True), nullable=True, default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    row_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


class KnowledgeFSShadowAuthorizationDiff(DefaultFieldsDCMixin, TypeBase):
    """Current disposition for a diff key; append-only observations retain its history."""

    __tablename__ = "knowledge_fs_shadow_authorization_diffs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_shadow_authorization_diff_pkey"),
        UniqueConstraint("tenant_id", "ledger_id", "diff_key", name="kfs_shadow_authorization_diff_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_shadow_authorization_diff_ledger_fk",
            ondelete="CASCADE",
        ),
        Index("kfs_shadow_authorization_diff_gate_idx", "tenant_id", "ledger_id", "status", "decision"),
        sa.CheckConstraint("row_version >= 0", name=sa.schema.conv("kfs_shadow_authorization_diff_version_ck")),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    ledger_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    diff_key: Mapped[str] = mapped_column(String(255), nullable=False)
    principal: Mapped[str] = mapped_column(String(255), nullable=False)
    dify_allowed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    decision: Mapped[KnowledgeFSShadowAuthorizationDecision] = mapped_column(
        EnumText(KnowledgeFSShadowAuthorizationDecision, length=32), nullable=False
    )
    reason: Mapped[str] = mapped_column(LongText, nullable=False)
    observed_revision: Mapped[KnowledgeFSCutoverRevisionWatermark] = mapped_column(sa.JSON, nullable=False)
    status: Mapped[KnowledgeFSMigrationIssueStatus] = mapped_column(
        EnumText(KnowledgeFSMigrationIssueStatus, length=32), nullable=False
    )
    current_evidence_digest: Mapped[str] = mapped_column(String(71), nullable=False)
    last_observed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    control_space_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    legacy_allowed: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)
    approved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    resolved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    row_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


class KnowledgeFSShadowAuthorizationObservation(DefaultFieldsDCMixin, TypeBase):
    """Append-only producer evidence used to derive a shadow diff disposition."""

    __tablename__ = "knowledge_fs_shadow_authorization_observations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_shadow_authorization_observation_pkey"),
        UniqueConstraint(
            "tenant_id",
            "ledger_id",
            "diff_key",
            "evidence_digest",
            name="kfs_shadow_authorization_observation_evidence_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_shadow_authorization_observation_ledger_fk",
            ondelete="CASCADE",
        ),
        Index(
            "kfs_shadow_authorization_observation_window_idx",
            "tenant_id",
            "ledger_id",
            "observed_at",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    ledger_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    diff_key: Mapped[str] = mapped_column(String(255), nullable=False)
    producer: Mapped[str] = mapped_column(String(255), nullable=False)
    principal: Mapped[str] = mapped_column(String(255), nullable=False)
    dify_allowed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    decision: Mapped[KnowledgeFSShadowAuthorizationDecision] = mapped_column(
        EnumText(KnowledgeFSShadowAuthorizationDecision, length=32), nullable=False
    )
    reason: Mapped[str] = mapped_column(LongText, nullable=False)
    observed_revision: Mapped[KnowledgeFSCutoverRevisionWatermark] = mapped_column(sa.JSON, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    evidence_digest: Mapped[str] = mapped_column(String(71), nullable=False)
    control_space_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    legacy_allowed: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, default=None)


__all__ = [
    "KnowledgeFSCutoverRevisionWatermark",
    "KnowledgeFSCutoverSmokeChecks",
    "KnowledgeFSCutoverSmokeEvidenceReferences",
    "KnowledgeFSCutoverSmokeResults",
    "KnowledgeFSMigrationIssue",
    "KnowledgeFSMigrationIssueKind",
    "KnowledgeFSMigrationIssueStatus",
    "KnowledgeFSMigrationQuarantine",
    "KnowledgeFSMigrationQuarantineDisposition",
    "KnowledgeFSMigrationQuarantineKind",
    "KnowledgeFSShadowAuthorizationDecision",
    "KnowledgeFSShadowAuthorizationDiff",
    "KnowledgeFSShadowAuthorizationObservation",
    "KnowledgeFSWorkspaceCutoverLedger",
    "KnowledgeFSWorkspaceCutoverPhase",
    "knowledge_fs_cutover_smoke_results_passed",
]
