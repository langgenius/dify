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
from sqlalchemy.exc import IntegrityError

_PATH = (
    Path(__file__).resolve().parents[4] / "migrations/versions/2026_11_13_1200-a9f07c7f10cf_unique_end_user_identity.py"
)


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("unique_end_user_identity", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_keeps_earliest_duplicate_and_enforces_uniqueness() -> None:
    """The dedupe keeps the earliest row per identity, then the index holds (#46267).

    Precondition: the table holds duplicate rows for one identity.
    Postcondition: exactly the earliest row survives per identity, the unique
    index rejects a second row for the same identity, and after downgrade
    the index is gone so duplicates insert again.
    """
    engine = sa.create_engine("sqlite:///:memory:")
    migration = _migration()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE end_users ("
                "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, "
                "session_id TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO end_users VALUES "
                "('old', 'tenant-1', 'app-1', 'session-1', 'service-api', '2026-01-01 00:00:00'), "
                "('new', 'tenant-1', 'app-1', 'session-1', 'service-api', '2026-01-02 00:00:00'), "
                "('tie-a', 'tenant-1', 'app-1', 'session-1', 'browser', '2026-01-01 00:00:00'), "
                "('tie-b', 'tenant-1', 'app-1', 'session-1', 'browser', '2026-01-01 00:00:00'), "
                "('other-app', 'tenant-1', 'app-2', 'session-1', 'service-api', '2026-01-01 00:00:00')"
            )
        )
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            remaining = connection.execute(sa.text("SELECT id FROM end_users ORDER BY id")).scalars().all()
            assert remaining == ["old", "other-app", "tie-a"]
            with pytest.raises(IntegrityError):
                connection.execute(
                    sa.text(
                        "INSERT INTO end_users VALUES "
                        "('again', 'tenant-1', 'app-1', 'session-1', 'service-api', '2026-01-03 00:00:00')"
                    )
                )
            migration.downgrade()
            connection.execute(
                sa.text(
                    "INSERT INTO end_users VALUES "
                    "('again', 'tenant-1', 'app-1', 'session-1', 'service-api', '2026-01-03 00:00:00')"
                )
            )
    engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_migration_renders_for_supported_databases(dialect: str) -> None:
    """The migration must render valid SQL for Postgres and MySQL (#46267)."""
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration = _migration()
    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    assert "DELETE FROM end_users" in sql
    assert "CREATE UNIQUE INDEX uq_end_user_tenant_app_session_type" in sql
    assert "DROP INDEX uq_end_user_tenant_app_session_type" in sql
