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
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_23_1200-53c10126d551_unique_trace_app_config_provider.py"
)


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("unique_trace_app_config_provider", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_most_recently_updated_duplicate_survives() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    migration = _migration()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE trace_app_config ("
                "id TEXT PRIMARY KEY, app_id TEXT NOT NULL, tracing_provider TEXT, updated_at TEXT NOT NULL)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO trace_app_config VALUES "
                "('old', 'app-1', 'langfuse', '2026-01-01'), "
                "('new', 'app-1', 'langfuse', '2026-02-01'), "
                "('tie-a', 'app-1', 'opik', '2026-01-01'), "
                "('tie-b', 'app-1', 'opik', '2026-01-01'), "
                "('other-app', 'app-2', 'langfuse', '2026-01-01'), "
                "('unset-1', 'app-3', NULL, '2026-01-01'), "
                "('unset-2', 'app-3', NULL, '2026-01-01')"
            )
        )
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            remaining = connection.execute(sa.text("SELECT id FROM trace_app_config ORDER BY id")).scalars().all()
            assert remaining == ["new", "other-app", "tie-b", "unset-1", "unset-2"]
            with pytest.raises(IntegrityError):
                connection.execute(
                    sa.text("INSERT INTO trace_app_config VALUES ('again', 'app-1', 'langfuse', '2026-03-01')")
                )
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
    assert "DELETE FROM trace_app_config" in sql
    assert "CREATE UNIQUE INDEX trace_app_config_app_provider_uq" in sql
    assert "DROP INDEX trace_app_config_app_provider_uq" in sql
