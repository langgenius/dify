from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSWorkspaceCutoverLedger,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3] / "migrations/versions/2026_07_21_1300-b7f2a9d41c60_add_knowledge_fs_cutover.py"
)

_MODELS = (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
)
_TABLES = {model.__tablename__ for model in _MODELS}
_FORBIDDEN_DEPENDENCIES = ("datasets", "documents", "dataset_permissions", "api_tokens")
_LATER_QUARANTINE_COLUMNS = {
    "resolved_by_operator",
    "resolved_by_account_id",
    "evidence",
    "row_version",
}
_LATER_LEDGER_COLUMNS = {
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
}
_LATER_SHADOW_DIFF_COLUMNS = {
    "current_evidence_digest",
    "last_observed_at",
    "row_version",
}


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("knowledge_fs_cutover", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_migration_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def test_upgrade_matches_models_and_has_only_cutover_ledger_dependencies() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == _TABLES
    for model in _MODELS:
        table_name = model.__tablename__
        migrated_columns = {column["name"] for column in inspector.get_columns(table_name)}
        expected_columns = set(model.__table__.columns.keys())
        if model is KnowledgeFSMigrationQuarantine:
            expected_columns -= _LATER_QUARANTINE_COLUMNS
        elif model is KnowledgeFSWorkspaceCutoverLedger:
            expected_columns -= _LATER_LEDGER_COLUMNS
        elif model is KnowledgeFSShadowAuthorizationDiff:
            expected_columns -= _LATER_SHADOW_DIFF_COLUMNS
        assert migrated_columns == expected_columns
        dependency_text = " ".join(
            [
                table_name,
                *migrated_columns,
                *(
                    referred_table
                    for fk in inspector.get_foreign_keys(table_name)
                    if (referred_table := fk.get("referred_table")) is not None
                ),
            ]
        ).lower()
        assert not any(forbidden in dependency_text for forbidden in _FORBIDDEN_DEPENDENCIES)
        assert {
            fk["referred_table"]
            for fk in inspector.get_foreign_keys(table_name)
            if fk.get("referred_table") is not None
        } <= {KnowledgeFSWorkspaceCutoverLedger.__tablename__}

    assert module.down_revision == "a4e7c2f91b30"


def test_cutover_migration_downgrade_is_symmetric() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")
    _run_migration_step(module, engine, "downgrade")

    assert not (_TABLES & set(sa.inspect(engine).get_table_names()))
