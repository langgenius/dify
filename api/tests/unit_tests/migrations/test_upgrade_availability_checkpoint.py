from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_21_1400-a8c2e6f4b901_add_upgrade_availability_checkpoint.py"
)


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("upgrade_availability_checkpoint", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_backfills_only_completed_reconciliations_and_downgrades() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    migration = _migration()
    with engine.begin() as connection:
        connection.execute(
            sa.text("CREATE TABLE knowledge_fs_upgrade_documents (id TEXT PRIMARY KEY, state_reconciled_at DATETIME)")
        )
        connection.execute(
            sa.text(
                "INSERT INTO knowledge_fs_upgrade_documents VALUES "
                "('complete', '2026-10-21 12:00:00'), ('pending', NULL)"
            )
        )
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            rows = connection.execute(
                sa.text(
                    "SELECT id, state_reconciled_at, availability_reconciled_at "
                    "FROM knowledge_fs_upgrade_documents ORDER BY id"
                )
            ).all()
            assert rows == [("complete", "2026-10-21 12:00:00", "2026-10-21 12:00:00"), ("pending", None, None)]
            migration.downgrade()
        assert [column["name"] for column in sa.inspect(connection).get_columns("knowledge_fs_upgrade_documents")] == [
            "id",
            "state_reconciled_at",
        ]
    engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_migration_renders_for_supported_databases(dialect: str) -> None:
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration = _migration()
    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    assert "ADD COLUMN availability_reconciled_at" in sql
    assert "WHERE state_reconciled_at IS NOT NULL" in sql
    assert "DROP COLUMN availability_reconciled_at" in sql
