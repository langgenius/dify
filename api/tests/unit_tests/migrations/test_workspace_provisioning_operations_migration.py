from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_19_1500-a4c8d2e5f917_add_workspace_provisioning_operations.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("workspace_provisioning_operations", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load workspace provisioning migration")
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


def test_workspace_provisioning_operation_migration_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration()

    _run(module, engine, "upgrade")
    inspector = sa.inspect(engine)
    assert "workspace_provisioning_operations" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("workspace_provisioning_operations")}
    assert {
        "workspace_id",
        "owner_account_id",
        "status",
        "lease_id",
        "lease_expires_at",
        "key_prepared",
        "rbac_prepared",
        "compensation_attempts",
        "last_error",
    } <= columns
    indexes = {index["name"] for index in inspector.get_indexes("workspace_provisioning_operations")}
    assert "workspace_provisioning_operations_recovery_idx" in indexes

    _run(module, engine, "downgrade")
    assert "workspace_provisioning_operations" not in sa.inspect(engine).get_table_names()
