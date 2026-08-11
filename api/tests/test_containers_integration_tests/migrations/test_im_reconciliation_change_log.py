"""PostgreSQL migration checks for forward-only IM reconciliation history."""

from __future__ import annotations

import importlib.util
from collections.abc import Generator
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.human_input_v2 import HumanInputIMReconciliationChange, HumanInputIMSyncResult

_MIGRATIONS_DIRECTORY = Path(__file__).resolve().parents[3] / "migrations/versions"
_BASE_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / "2026_07_25_1100-6d9f2b4c5e7a_add_human_input_v2_im_control_plane.py"
_CHANGE_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / "2026_08_11_1000-b7d3e5f9a1c2_add_im_reconciliation_change_log.py"
_HISTORICAL_RESULT_ID = "00000000-0000-0000-0000-000000000101"
_INTEGRATION_ID = "00000000-0000-0000-0000-000000000201"
_HISTORICAL_RUN_ID = "00000000-0000-0000-0000-000000000301"
_NEW_RUN_ID = "00000000-0000-0000-0000-000000000302"


def _load_migration(path: Path, module_name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load migration: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_step(module: ModuleType, engine: Engine, schema: str, step_name: str) -> None:
    with engine.begin() as connection:
        quoted_schema = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(sa.text(f"SET LOCAL search_path TO {quoted_schema}"))
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


@pytest.fixture
def migration_schema(db_session_with_containers: Session) -> Generator[tuple[Engine, str], None, None]:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    schema = f"im_sync_migration_{uuid4().hex}"
    with engine.begin() as connection:
        connection.execute(sa.schema.CreateSchema(schema))
    try:
        yield engine, schema
    finally:
        with engine.begin() as connection:
            connection.execute(sa.schema.DropSchema(schema, cascade=True))


def _upgrade_base(engine: Engine, schema: str) -> None:
    _run_step(_load_migration(_BASE_MIGRATION_PATH, f"im_control_plane_base_{schema}"), engine, schema, "upgrade")


def _insert_historical_result(engine: Engine, schema: str) -> None:
    with engine.begin() as connection:
        quoted_schema = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(
            sa.text(
                f"INSERT INTO {quoted_schema}.human_input_im_sync_results "
                "(id, integration_id, sync_run_id, result_type) "
                "VALUES (:result_id, :integration_id, :sync_run_id, 'not_matched')"
            ),
            {
                "result_id": _HISTORICAL_RESULT_ID,
                "integration_id": _INTEGRATION_ID,
                "sync_run_id": _HISTORICAL_RUN_ID,
            },
        )


def _insert_duplicate_results(engine: Engine, statement: sa.TextClause) -> None:
    with engine.begin() as connection:
        connection.execute(
            statement,
            [
                {
                    "id": "00000000-0000-0000-0000-000000000102",
                    "integration_id": _INTEGRATION_ID,
                    "sync_run_id": _NEW_RUN_ID,
                },
                {
                    "id": "00000000-0000-0000-0000-000000000103",
                    "integration_id": _INTEGRATION_ID,
                    "sync_run_id": _NEW_RUN_ID,
                },
            ],
        )


def test_upgrade_enforces_postgresql_shape_constraints_and_preserves_history(migration_schema) -> None:
    engine, schema = migration_schema
    _upgrade_base(engine, schema)
    _insert_historical_result(engine, schema)
    migration = _load_migration(_CHANGE_MIGRATION_PATH, f"im_reconciliation_change_log_{schema}")

    _run_step(migration, engine, schema, "upgrade")

    inspector = sa.inspect(engine)
    result_table = HumanInputIMSyncResult.__tablename__
    change_table = HumanInputIMReconciliationChange.__tablename__
    assert {column["name"] for column in inspector.get_columns(result_table, schema=schema)} == {
        column.name for column in HumanInputIMSyncResult.__table__.columns
    }
    assert {column["name"] for column in inspector.get_columns(change_table, schema=schema)} == {
        column.name for column in HumanInputIMReconciliationChange.__table__.columns
    }
    assert {constraint["name"] for constraint in inspector.get_unique_constraints(result_table, schema=schema)} >= {
        "human_input_im_sync_results_run_operation_uq"
    }
    assert {constraint["name"] for constraint in inspector.get_unique_constraints(change_table, schema=schema)} == {
        "human_input_im_reconciliation_changes_run_operation_uq"
    }
    assert {constraint["name"] for constraint in inspector.get_check_constraints(change_table, schema=schema)} == {
        "snapshot_operation_shape",
        "snapshot_present",
        "subject_identifier_shape",
    }
    assert {index["name"] for index in inspector.get_indexes(change_table, schema=schema)} >= {
        "hiimrc_integration_committed_idx",
        "hiimrc_run_subject_committed_idx",
    }

    quoted_schema = engine.dialect.identifier_preparer.quote_schema(schema)
    with engine.begin() as connection:
        historical = (
            connection.execute(
                sa.text(
                    f"SELECT id, operation_key FROM {quoted_schema}.human_input_im_sync_results WHERE id = :result_id"
                ),
                {"result_id": _HISTORICAL_RESULT_ID},
            )
            .mappings()
            .one()
        )
    assert str(historical["id"]) == _HISTORICAL_RESULT_ID
    assert historical["operation_key"] is None

    duplicate_result = sa.text(
        f"INSERT INTO {quoted_schema}.human_input_im_sync_results "
        "(id, integration_id, sync_run_id, result_type, operation_key) "
        "VALUES (:id, :integration_id, :sync_run_id, 'not_matched', "
        "'result:not-matched:provider-user-1')"
    )
    with pytest.raises(IntegrityError):
        _insert_duplicate_results(engine, duplicate_result)

    invalid_snapshot = sa.text(
        f"INSERT INTO {quoted_schema}.human_input_im_reconciliation_changes "
        "(id, integration_id, sync_run_id, operation_key, subject_kind, operation, reason_code, "
        "im_identity_id, committed_at, before_snapshot, after_snapshot) "
        "VALUES ('00000000-0000-0000-0000-000000000401', "
        "'00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000302', "
        "'identity:create:provider-user-1', 'identity', 'create', 'new_identity', "
        "'00000000-0000-0000-0000-000000000501', CURRENT_TIMESTAMP, '{}', '{}')"
    )
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(invalid_snapshot)


def test_downgrade_removes_only_forward_history_schema(migration_schema) -> None:
    engine, schema = migration_schema
    _upgrade_base(engine, schema)
    migration = _load_migration(_CHANGE_MIGRATION_PATH, f"im_reconciliation_change_log_downgrade_{schema}")
    _run_step(migration, engine, schema, "upgrade")
    quoted_schema = engine.dialect.identifier_preparer.quote_schema(schema)
    with engine.begin() as connection:
        connection.execute(sa.text(f"CREATE TABLE {quoted_schema}.unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text(f"INSERT INTO {quoted_schema}.unrelated_state (id) VALUES (1)"))

    _run_step(migration, engine, schema, "downgrade")

    inspector = sa.inspect(engine)
    assert HumanInputIMReconciliationChange.__tablename__ not in inspector.get_table_names(schema=schema)
    assert "operation_key" not in {
        column["name"] for column in inspector.get_columns(HumanInputIMSyncResult.__tablename__, schema=schema)
    }
    with engine.begin() as connection:
        assert connection.scalar(sa.text(f"SELECT id FROM {quoted_schema}.unrelated_state")) == 1
