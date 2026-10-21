from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_20_1700-c6e0f4a7b139_add_app_cleanup_operations.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("app_cleanup_operations", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load App cleanup migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: ModuleType, engine: sa.Engine, step: str) -> None:
    migration_step = module.__dict__[step]
    if not callable(migration_step):
        raise TypeError(f"migration step {step!r} is not callable")
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            migration_step()
        finally:
            module.__dict__["op"] = original_op


def test_app_cleanup_operation_migration_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration()
    assert module.revision == "c6e0f4a7b139"
    assert module.down_revision == "b5d9e3f6a028"

    _run(module, engine, "upgrade")
    inspector = sa.inspect(engine)
    assert "app_cleanup_operations" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("app_cleanup_operations")}
    assert {
        "app_id",
        "tenant_id",
        "status",
        "available_at",
        "lease_id",
        "lease_expires_at",
        "attempts",
        "last_error",
        "finished_at",
    } <= columns
    indexes = {index["name"] for index in inspector.get_indexes("app_cleanup_operations")}
    assert "app_cleanup_operations_recovery_idx" in indexes

    _run(module, engine, "downgrade")
    assert "app_cleanup_operations" not in sa.inspect(engine).get_table_names()
