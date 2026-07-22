from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs import KnowledgeFSCapabilityIssuanceReservation, KnowledgeFSControlSpace
from models.knowledge_fs_cleanup import KnowledgeFSCleanupAuthorization
from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_21_1400-c8e31b7d52a4_add_knowledge_fs_cleanup_authorization.py"
)
_CUTOVER_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3] / "migrations/versions/2026_07_21_1300-b7f2a9d41c60_add_knowledge_fs_cutover.py"
)
_LATER_LEDGER_COLUMNS = {
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
_LATER_CLEANUP_COLUMNS = {
    "completed_by_account_id",
    "completed_at",
    "completion_evidence",
    "completed_ledger_cas_version",
}


def _load_migration_module(path: Path = _MIGRATION_PATH):
    spec = importlib.util.spec_from_file_location(path.stem, path)
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


def test_upgrade_matches_cleanup_authorization_model_and_only_references_cutover_ledger() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    cutover_module = _load_migration_module(_CUTOVER_MIGRATION_PATH)
    module = _load_migration_module()

    _run_migration_step(cutover_module, engine, "upgrade")
    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    table_name = KnowledgeFSCleanupAuthorization.__tablename__
    assert table_name in inspector.get_table_names()
    assert {column["name"] for column in inspector.get_columns(table_name)} == (
        set(KnowledgeFSCleanupAuthorization.__table__.columns.keys()) - _LATER_CLEANUP_COLUMNS
    )
    assert {foreign_key["referred_table"] for foreign_key in inspector.get_foreign_keys(table_name)} == {
        KnowledgeFSWorkspaceCutoverLedger.__tablename__
    }
    assert {foreign_key["options"].get("ondelete") for foreign_key in inspector.get_foreign_keys(table_name)} == {None}
    reservation_table = KnowledgeFSCapabilityIssuanceReservation.__tablename__
    assert reservation_table in inspector.get_table_names()
    assert {column["name"] for column in inspector.get_columns(reservation_table)} == set(
        KnowledgeFSCapabilityIssuanceReservation.__table__.columns.keys()
    )
    assert {foreign_key["referred_table"] for foreign_key in inspector.get_foreign_keys(reservation_table)} == {
        KnowledgeFSControlSpace.__tablename__
    }
    quarantine_table = KnowledgeFSMigrationQuarantine.__tablename__
    assert {column["name"] for column in inspector.get_columns(quarantine_table)} == set(
        KnowledgeFSMigrationQuarantine.__table__.columns.keys()
    )
    assert {
        "kfs_migration_quarantine_resolution_fields_ck",
        "kfs_migration_quarantine_version_ck",
    } <= {constraint["name"] for constraint in inspector.get_check_constraints(quarantine_table)}
    ledger_table = KnowledgeFSWorkspaceCutoverLedger.__tablename__
    assert {column["name"] for column in inspector.get_columns(ledger_table)} == (
        set(KnowledgeFSWorkspaceCutoverLedger.__table__.columns.keys()) - _LATER_LEDGER_COLUMNS
    )
    assert {
        "kfs_workspace_cutover_remote_activation_fields_ck",
        "kfs_workspace_cutover_remote_activation_time_ck",
        "kfs_workspace_cutover_shadow_completion_fields_ck",
        "kfs_workspace_cutover_shadow_count_ck",
        "kfs_workspace_cutover_shadow_window_ck",
    } <= {constraint["name"] for constraint in inspector.get_check_constraints(ledger_table)}
    diff_table = KnowledgeFSShadowAuthorizationDiff.__tablename__
    assert {column["name"] for column in inspector.get_columns(diff_table)} == set(
        KnowledgeFSShadowAuthorizationDiff.__table__.columns.keys()
    )
    observation_table = KnowledgeFSShadowAuthorizationObservation.__tablename__
    assert {column["name"] for column in inspector.get_columns(observation_table)} == set(
        KnowledgeFSShadowAuthorizationObservation.__table__.columns.keys()
    )
    assert {foreign_key["referred_table"] for foreign_key in inspector.get_foreign_keys(observation_table)} == {
        KnowledgeFSWorkspaceCutoverLedger.__tablename__
    }
    assert module.down_revision == "b7f2a9d41c60"


def test_cleanup_authorization_migration_downgrade_is_symmetric() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    cutover_module = _load_migration_module(_CUTOVER_MIGRATION_PATH)
    module = _load_migration_module()

    _run_migration_step(cutover_module, engine, "upgrade")
    _run_migration_step(module, engine, "upgrade")
    _run_migration_step(module, engine, "downgrade")

    inspector = sa.inspect(engine)
    assert KnowledgeFSCleanupAuthorization.__tablename__ not in inspector.get_table_names()
    assert KnowledgeFSCapabilityIssuanceReservation.__tablename__ not in inspector.get_table_names()
    assert KnowledgeFSShadowAuthorizationObservation.__tablename__ not in inspector.get_table_names()
    quarantine_columns = {
        column["name"] for column in inspector.get_columns(KnowledgeFSMigrationQuarantine.__tablename__)
    }
    assert (
        not {
            "resolved_by_operator",
            "resolved_by_account_id",
            "evidence",
            "row_version",
        }
        & quarantine_columns
    )
    ledger_columns = {
        column["name"] for column in inspector.get_columns(KnowledgeFSWorkspaceCutoverLedger.__tablename__)
    }
    assert not {column for column in ledger_columns if column.startswith("shadow_")}
    assert not {column for column in ledger_columns if column.startswith("remote_activation_")}
    diff_columns = {
        column["name"] for column in inspector.get_columns(KnowledgeFSShadowAuthorizationDiff.__tablename__)
    }
    assert not {"current_evidence_digest", "last_observed_at", "row_version"} & diff_columns
