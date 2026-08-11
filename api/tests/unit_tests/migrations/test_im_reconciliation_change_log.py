"""Migration tests for append-only IM reconciliation change history."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.human_input_v2 import HumanInputIMReconciliationChange, HumanInputIMSyncResult

_MIGRATIONS_DIRECTORY = Path(__file__).resolve().parents[3] / "migrations/versions"
_BASE_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / "2026_07_25_1100-6d9f2b4c5e7a_add_human_input_v2_im_control_plane.py"
_CHANGE_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / "2026_08_11_1000-b7d3e5f9a1c2_add_im_reconciliation_change_log.py"


def _load_migration(path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load migration: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def _upgrade_base(engine: sa.Engine) -> None:
    _run_step(_load_migration(_BASE_MIGRATION_PATH, "im_control_plane_base"), engine, "upgrade")


def test_upgrade_adds_change_log_shape_and_preserves_historical_results() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_base(engine)
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO human_input_im_sync_results "
                "(id, integration_id, sync_run_id, result_type) "
                "VALUES ('result-1', 'integration-1', 'run-1', 'not_matched')"
            )
        )
    migration = _load_migration(_CHANGE_MIGRATION_PATH, "im_reconciliation_change_log")

    _run_step(migration, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) >= {
        HumanInputIMSyncResult.__tablename__,
        HumanInputIMReconciliationChange.__tablename__,
    }
    assert {column["name"] for column in inspector.get_columns(HumanInputIMSyncResult.__tablename__)} == {
        column.name for column in HumanInputIMSyncResult.__table__.columns
    }
    assert {column["name"] for column in inspector.get_columns(HumanInputIMReconciliationChange.__tablename__)} == {
        column.name for column in HumanInputIMReconciliationChange.__table__.columns
    }
    result_uniques = {
        constraint["name"] for constraint in inspector.get_unique_constraints(HumanInputIMSyncResult.__tablename__)
    }
    assert "human_input_im_sync_results_run_operation_uq" in result_uniques
    change_uniques = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(HumanInputIMReconciliationChange.__tablename__)
    }
    assert change_uniques == {"human_input_im_reconciliation_changes_run_operation_uq"}
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints(HumanInputIMReconciliationChange.__tablename__)
    } == {"snapshot_present", "snapshot_operation_shape", "subject_identifier_shape"}
    with engine.begin() as connection:
        stored = (
            connection.execute(sa.text("SELECT id, operation_key FROM human_input_im_sync_results")).mappings().one()
        )
        assert stored == {"id": "result-1", "operation_key": None}


def test_downgrade_removes_only_forward_change_history_schema() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_base(engine)
    migration = _load_migration(_CHANGE_MIGRATION_PATH, "im_reconciliation_change_log_downgrade")
    _run_step(migration, engine, "upgrade")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))

    _run_step(migration, engine, "downgrade")

    inspector = sa.inspect(engine)
    assert HumanInputIMReconciliationChange.__tablename__ not in inspector.get_table_names()
    assert "operation_key" not in {
        column["name"] for column in inspector.get_columns(HumanInputIMSyncResult.__tablename__)
    }
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
