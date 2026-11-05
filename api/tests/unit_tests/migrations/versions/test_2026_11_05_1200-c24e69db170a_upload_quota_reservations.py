"""Portable DDL and a real SQLite migration round trip preserve historical uploads."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load_migration() -> ModuleType:
    """Load this exact migration without booting Flask or running unrelated migrations."""
    path = Path(__file__).resolve().parents[4] / (
        "migrations/versions/2026_11_05_1200-c24e69db170a_upload_quota_reservations.py"
    )
    spec = importlib.util.spec_from_file_location("upload_quota_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_and_downgrade_preserve_historical_rows() -> None:
    """Add/remove accounting schema without rewriting old files or losing the tenant index."""
    migration = load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    uploads = sa.Table(
        "upload_files",
        metadata,
        sa.Column("tenant_id", sa.String),
        sa.Column("created_by_role", sa.String),
        sa.Column("size", sa.Integer),
    )
    sa.Index("upload_file_tenant_idx", uploads.c.tenant_id)
    metadata.create_all(engine)
    try:
        with engine.begin() as connection:
            connection.execute(uploads.insert().values(tenant_id="workspace", created_by_role="end-user", size=7))
            migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
            migration.upgrade()
            assert "upload_quota_reservations" in sa.inspect(connection).get_table_names()
            indexes = sa.inspect(connection).get_indexes("upload_files")
            assert [(index["name"], index["column_names"]) for index in indexes] == [
                ("upload_file_tenant_role_size_idx", ["tenant_id", "created_by_role", "size"])
            ]
            assert connection.execute(sa.select(uploads)).one() == ("workspace", "end-user", 7)
            migration.downgrade()
            assert "upload_quota_reservations" not in sa.inspect(connection).get_table_names()
            assert sa.inspect(connection).get_indexes("upload_files")[0]["name"] == "upload_file_tenant_idx"
            assert connection.execute(sa.select(uploads)).one() == ("workspace", "end-user", 7)
    finally:
        engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_ddl_is_portable(dialect: str) -> None:
    """Compile both supported dialects; this does not establish runtime DB locking behavior."""
    migration = load_migration()
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration.__dict__["op"] = Operations(context)
    migration.upgrade()
    migration.downgrade()
    sql = output.getvalue()
    assert "CREATE TABLE upload_quota_reservations" in sql
    assert "BIGINT" in sql
    assert "upload_file_tenant_role_size_idx" in sql
    assert "DROP TABLE upload_quota_reservations" in sql
