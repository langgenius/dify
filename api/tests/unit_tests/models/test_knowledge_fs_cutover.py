from __future__ import annotations

import sqlalchemy as sa

from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)

_MODELS = (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
)


def test_cutover_ledger_has_strict_phases_watermarks_fences_and_atomic_switches() -> None:
    assert [phase.value for phase in KnowledgeFSWorkspaceCutoverPhase] == [
        "inventory",
        "backfill",
        "shadow",
        "frozen",
        "cutover",
        "observing",
        "ready_for_cleanup",
    ]
    columns = set(KnowledgeFSWorkspaceCutoverLedger.__table__.columns.keys())
    assert {
        "source_revision_watermark",
        "final_revision_watermark",
        "applied_revision_watermark",
        "source_task_watermark",
        "final_task_watermark",
        "applied_task_watermark",
        "freeze_at",
        "cutover_at",
        "rolled_back_at",
        "rollback_cutoff_at",
        "observation_started_at",
        "observation_window_ends_at",
        "observation_completed_at",
        "maximum_task_expires_at",
        "irreversible_cleanup_at",
        "product_routes_enabled",
        "capability_v2_enabled",
        "integrated_mode_enabled",
        "legacy_acl_read_only",
        "smoke_results",
        "legacy_dependency_report",
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
        "remote_activation_id",
        "remote_activation_revision",
        "remote_activation_digest",
        "remote_activation_control_space_id",
        "remote_activation_activated_at",
        "remote_activation_updated_at",
        "remote_activation_acknowledged_at",
        "remote_activation_applied",
        "remote_activation_replayed",
        "cas_version",
    } <= columns


def test_cutover_evidence_models_depend_only_on_the_workspace_ledger() -> None:
    ledger_table = KnowledgeFSWorkspaceCutoverLedger.__tablename__
    for model in _MODELS:
        table = model.__table__
        assert not model.__mapper__.relationships
        assert {foreign_key.column.table.name for foreign_key in table.foreign_keys} <= {ledger_table}
        if model is KnowledgeFSWorkspaceCutoverLedger:
            assert any(
                isinstance(constraint, sa.UniqueConstraint)
                and tuple(column.name for column in constraint.columns) == ("tenant_id",)
                for constraint in table.constraints
            )


def test_quarantine_resolution_is_fully_auditable_and_versioned() -> None:
    assert {
        "resolved_by_operator",
        "resolved_by_account_id",
        "evidence",
        "resolved_at",
        "row_version",
    } <= set(KnowledgeFSMigrationQuarantine.__table__.columns.keys())


def test_shadow_evidence_has_append_only_history_and_versioned_current_disposition() -> None:
    assert {
        "current_evidence_digest",
        "last_observed_at",
        "row_version",
    } <= set(KnowledgeFSShadowAuthorizationDiff.__table__.columns.keys())
    assert {
        "producer",
        "observed_at",
        "observed_revision",
        "evidence_digest",
    } <= set(KnowledgeFSShadowAuthorizationObservation.__table__.columns.keys())
