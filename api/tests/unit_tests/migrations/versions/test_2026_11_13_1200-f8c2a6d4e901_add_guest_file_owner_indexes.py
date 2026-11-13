from collections.abc import Iterator
from importlib import import_module
from io import StringIO
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import event
from sqlalchemy.engine import Connection

from models.model import UploadFile
from models.tools import ToolFile


@pytest.fixture
def migration() -> ModuleType:
    """Load the revision without executing DDL; return its migration module."""
    return import_module("migrations.versions.2026_11_13_1200-f8c2a6d4e901_add_guest_file_owner_indexes")


@pytest.fixture
def connection() -> Iterator[Connection]:
    """Create the parent index state with file rows and dispose it after each test."""
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    uploads = sa.Table(
        "upload_files",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("tenant_id", sa.String),
        sa.Column("created_by_role", sa.String),
        sa.Column("created_by", sa.String),
    )
    tools = sa.Table(
        "tool_files",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("tenant_id", sa.String),
        sa.Column("user_id", sa.String),
        sa.Column("conversation_id", sa.String),
    )
    sa.Index("upload_file_tenant_idx", uploads.c.tenant_id)
    sa.Index("tool_file_conversation_id_idx", tools.c.conversation_id)
    metadata.create_all(engine)
    with engine.begin() as bind:
        bind.execute(
            uploads.insert().values(id="upload", tenant_id="tenant", created_by_role="end_user", created_by="guest")
        )
        bind.execute(tools.insert().values(id="tool", tenant_id="tenant", user_id="guest", conversation_id=None))
        yield bind
    engine.dispose()


def test_upgrade_and_downgrade_preserve_rows_and_support_retries(
    migration: ModuleType, connection: Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Upgrade and retry both directions; preserve owners and unrelated indexes."""
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    before = {
        table: connection.execute(sa.text(f"SELECT * FROM {table}")).all() for table in ("upload_files", "tool_files")
    }
    migration.upgrade()
    migration.upgrade()
    assert {index["name"]: index["column_names"] for index in sa.inspect(connection).get_indexes("upload_files")} == {
        "upload_file_owner_idx": ["tenant_id", "created_by_role", "created_by"]
    }
    assert {index["name"]: index["column_names"] for index in sa.inspect(connection).get_indexes("tool_files")} == {
        "tool_file_owner_idx": ["tenant_id", "user_id"],
        "tool_file_conversation_id_idx": ["conversation_id"],
    }
    for table, rows in before.items():
        assert connection.execute(sa.text(f"SELECT * FROM {table}")).all() == rows
    migration.downgrade()
    migration.downgrade()
    assert {index["name"]: index["column_names"] for index in sa.inspect(connection).get_indexes("upload_files")} == {
        "upload_file_tenant_idx": ["tenant_id"]
    }
    assert {index["name"]: index["column_names"] for index in sa.inspect(connection).get_indexes("tool_files")} == {
        "tool_file_conversation_id_idx": ["conversation_id"]
    }
    for table, rows in before.items():
        assert connection.execute(sa.text(f"SELECT * FROM {table}")).all() == rows


@pytest.mark.parametrize("kind", ["wrong_columns", "unique", "partial"])
def test_upgrade_rejects_conflicting_owner_index(
    migration: ModuleType, connection: Connection, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    """Given a conflicting name, fail without removing the existing tenant index."""
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    table = sa.Table("upload_files", sa.MetaData(), autoload_with=connection)
    sa.Index(
        "upload_file_owner_idx",
        *(
            [table.c.created_by]
            if kind == "wrong_columns"
            else [table.c.tenant_id, table.c.created_by_role, table.c.created_by]
        ),
        unique=kind == "unique",
        sqlite_where=table.c.created_by.is_not(None) if kind == "partial" else None,
    ).create(connection)
    with pytest.raises(RuntimeError, match="differs from"):
        migration.upgrade()
    assert "upload_file_tenant_idx" in {index["name"] for index in sa.inspect(connection).get_indexes("upload_files")}


def test_upgrade_recovers_after_partial_ddl_failure(
    migration: ModuleType, connection: Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fail after the first owner index succeeds; retry without losing tenant coverage."""
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))

    def fail_tool_index(
        _conn: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        """Reject tool owner DDL to simulate failure after upload owner DDL succeeds."""
        if statement.startswith("CREATE INDEX tool_file_owner_idx"):
            raise RuntimeError("index build interrupted")

    event.listen(connection, "before_cursor_execute", fail_tool_index)
    try:
        with pytest.raises(RuntimeError, match="index build interrupted"):
            migration.upgrade()
    finally:
        event.remove(connection, "before_cursor_execute", fail_tool_index)
    assert {index["name"] for index in sa.inspect(connection).get_indexes("upload_files")} == {
        "upload_file_tenant_idx",
        "upload_file_owner_idx",
    }
    migration.upgrade()
    assert {index["name"] for index in sa.inspect(connection).get_indexes("upload_files")} == {"upload_file_owner_idx"}


def test_owner_queries_use_composite_indexes(
    migration: ModuleType, connection: Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Compile migrated SQLite owner lookups and require indexed rather than full scans."""
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    migration.upgrade()
    for table, predicate, name in (
        (
            "upload_files",
            "tenant_id = 'tenant' AND created_by_role = 'end_user' AND created_by = 'guest'",
            "upload_file_owner_idx",
        ),
        ("tool_files", "tenant_id = 'tenant' AND user_id = 'guest'", "tool_file_owner_idx"),
    ):
        plan = connection.execute(sa.text(f"EXPLAIN QUERY PLAN SELECT id FROM {table} WHERE {predicate}")).all()
        assert any("SEARCH" in row[3] and name in row[3] for row in plan)


@pytest.mark.parametrize("healthy", [True, False])
def test_postgresql_existing_index_requires_healthy_build(
    migration: ModuleType, monkeypatch: pytest.MonkeyPatch, healthy: bool
) -> None:
    """Reuse matching healthy PostgreSQL indexes; reject abandoned invalid builds."""
    operations = MagicMock()
    operations.get_bind.return_value.dialect.name = "postgresql"
    operations.get_bind.return_value.scalar.return_value = healthy
    inspector = MagicMock()
    inspector.get_indexes.return_value = [
        {
            "name": "tool_file_owner_idx",
            "column_names": ["tenant_id", "user_id"],
            "unique": False,
            "dialect_options": {"postgresql_include": list[str]()},
        }
    ]
    monkeypatch.setattr(migration, "op", operations)
    monkeypatch.setattr(sa, "inspect", lambda _bind: inspector)
    if healthy:
        assert migration._index_exists("tool_files", "tool_file_owner_idx", ["tenant_id", "user_id"])
    else:
        with pytest.raises(RuntimeError, match="unhealthy"):
            migration._index_exists("tool_files", "tool_file_owner_idx", ["tenant_id", "user_id"])


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_ddl_creates_replacement_before_dropping_old_index(
    migration: ModuleType, monkeypatch: pytest.MonkeyPatch, dialect: str
) -> None:
    """Compile both directions for each dialect, preserving index coverage order."""
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    monkeypatch.setattr(migration, "op", Operations(context))
    with context.begin_transaction():
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    concurrent = "CONCURRENTLY " if dialect == "postgresql" else ""
    create_upload = (
        f"CREATE INDEX {concurrent}upload_file_owner_idx ON upload_files (tenant_id, created_by_role, created_by)"
    )
    create_tool = f"CREATE INDEX {concurrent}tool_file_owner_idx ON tool_files (tenant_id, user_id)"
    drop_tenant = f"DROP INDEX {concurrent}upload_file_tenant_idx"
    create_tenant = f"CREATE INDEX {concurrent}upload_file_tenant_idx ON upload_files (tenant_id)"
    drop_tool = f"DROP INDEX {concurrent}tool_file_owner_idx"
    drop_upload = f"DROP INDEX {concurrent}upload_file_owner_idx"
    assert sql.index(create_upload) < sql.index(create_tool) < sql.index(drop_tenant)
    assert sql.index(drop_tenant) < sql.index(create_tenant) < sql.index(drop_tool) < sql.index(drop_upload)
    assert sql.count("CREATE INDEX") == sql.count("DROP INDEX") == 3
    if dialect == "postgresql":
        statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
        for ddl in (create_upload, create_tool, drop_tenant, create_tenant, drop_tool, drop_upload):
            position = statements.index(ddl)
            assert statements[position - 1] == "COMMIT"
            assert statements[position + 1] == "BEGIN"
    else:
        assert "CONCURRENTLY" not in sql
        for name, table in (
            ("upload_file_tenant_idx", "upload_files"),
            ("tool_file_owner_idx", "tool_files"),
            ("upload_file_owner_idx", "upload_files"),
        ):
            assert f"DROP INDEX {name} ON {table}" in sql


def test_model_indexes_and_revision_head_match(migration: ModuleType) -> None:
    """Require model owner indexes to match DDL and keep a single revision head."""
    for model, name, columns in (
        (UploadFile, "upload_file_owner_idx", ["tenant_id", "created_by_role", "created_by"]),
        (ToolFile, "tool_file_owner_idx", ["tenant_id", "user_id"]),
    ):
        table = model.__table__
        assert isinstance(table, sa.Table)
        index = next(index for index in table.indexes if index.name == name)
        assert [column.name for column in index.columns] == columns
        assert not index.unique
        if model is UploadFile:
            assert "upload_file_tenant_idx" not in {index.name for index in table.indexes}
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[4] / "migrations"))
    assert ScriptDirectory.from_config(configuration).get_heads() == [migration.revision]
    assert migration.down_revision == "2c7e9a4b1d60"
