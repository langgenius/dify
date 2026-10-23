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
    / "migrations/versions/2026_10_21_1500-b9d3f7a5c102_add_upgrade_reconciliation_lease.py"
)


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("upgrade_reconciliation_lease", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_existing_successful_jobs_remain_recoverable_after_migration() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    migration = _migration()
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE knowledge_fs_upgrade_jobs (id TEXT PRIMARY KEY, status TEXT)"))
        connection.execute(sa.text("INSERT INTO knowledge_fs_upgrade_jobs VALUES ('stranded', 'succeeded')"))
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            assert connection.execute(sa.text("SELECT * FROM knowledge_fs_upgrade_jobs")).one() == (
                "stranded",
                "succeeded",
                None,
                None,
                None,
            )
            migration.downgrade()
        assert connection.execute(sa.text("SELECT * FROM knowledge_fs_upgrade_jobs")).one() == ("stranded", "succeeded")
    engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_reconciliation_lease_migration_renders_for_supported_databases(dialect: str) -> None:
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration = _migration()
    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    for column in ("reconciliation_task_id", "reconciliation_started_at", "reconciliation_lease_expires_at"):
        assert f"ADD COLUMN {column}" in sql
        assert f"DROP COLUMN {column}" in sql
