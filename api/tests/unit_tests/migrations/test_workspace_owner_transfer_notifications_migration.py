from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_21_1100-a0c4d8ebf573_add_workspace_owner_transfer_notifications.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("workspace_owner_transfer_notifications", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load workspace owner transfer notifications migration")
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


def test_workspace_owner_transfer_notifications_migration_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration()

    _run(module, engine, "upgrade")
    inspector = sa.inspect(engine)
    table_name = "workspace_owner_transfer_notifications"
    assert table_name in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns(table_name)}
    assert {
        "notification_id",
        "operation_id",
        "workspace_id",
        "old_owner_account_id",
        "new_owner_account_id",
        "recipient_type",
        "recipient_email",
        "recipient_language",
        "workspace_name",
        "new_owner_email",
        "status",
        "claim_id",
        "lease_expires_at",
        "next_attempt_at",
        "attempts",
        "last_error",
        "created_at",
        "updated_at",
        "sent_at",
    } == columns
    indexes = {index["name"] for index in inspector.get_indexes(table_name)}
    assert "workspace_owner_transfer_notifications_delivery_idx" in indexes
    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}
    assert "workspace_owner_transfer_notifications_operation_recipient_key" in unique_constraints

    _run(module, engine, "downgrade")
    assert table_name not in sa.inspect(engine).get_table_names()
