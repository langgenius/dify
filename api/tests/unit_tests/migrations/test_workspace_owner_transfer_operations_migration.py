from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_20_1900-e8a2b6c9d351_add_workspace_owner_transfer_operations.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("workspace_owner_transfer_operations", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load workspace owner transfer migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: ModuleType, engine: sa.Engine, step: str) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            getattr(module, step)()
        finally:
            module.__dict__["op"] = original_op


def test_workspace_owner_transfer_operation_migration_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration()

    _run(module, engine, "upgrade")
    inspector = sa.inspect(engine)
    assert "workspace_owner_transfer_operations" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("workspace_owner_transfer_operations")}
    assert {
        "workspace_id",
        "operation_id",
        "old_owner_account_id",
        "new_owner_account_id",
        "possible_owner_account_ids",
        "status",
        "execution_id",
        "lease_expires_at",
        "next_reconcile_at",
        "attempts",
        "last_error",
        "created_at",
        "updated_at",
    } == columns
    indexes = {index["name"] for index in inspector.get_indexes("workspace_owner_transfer_operations")}
    assert "workspace_owner_transfer_operations_recovery_idx" in indexes

    _run(module, engine, "downgrade")
    assert "workspace_owner_transfer_operations" not in sa.inspect(engine).get_table_names()
