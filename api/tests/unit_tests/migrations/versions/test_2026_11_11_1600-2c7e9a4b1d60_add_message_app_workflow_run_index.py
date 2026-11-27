"""Verify the app/run lookup index and its portable, data-preserving migration."""

from importlib import import_module
from io import StringIO

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.model import Message

_MIGRATION = "migrations.versions.2026_11_11_1600-2c7e9a4b1d60_add_message_app_workflow_run_index"
_INDEX_NAME = "message_app_workflow_run_idx"
_COLUMNS = ["app_id", "workflow_run_id", "conversation_id"]


def test_upgrade_and_downgrade_preserve_rows_and_existing_indexes() -> None:
    """Given historical rows and indexes, round-trip the migration without changing either."""
    migration = import_module(_MIGRATION)
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    messages = sa.Table(
        "messages",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("app_id", sa.String, nullable=False),
        sa.Column("workflow_run_id", sa.String),
        sa.Column("conversation_id", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.Index("message_app_id_idx", "app_id", "created_at"),
        sa.Index("message_workflow_run_id_idx", "conversation_id", "workflow_run_id"),
    )
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(
                messages.insert(),
                [
                    {"id": "first", "app_id": "app", "workflow_run_id": "run", "conversation_id": "conversation"},
                    {"id": "second", "app_id": "app", "workflow_run_id": "run", "conversation_id": "conversation"},
                    {"id": "no-run", "app_id": "app", "workflow_run_id": None, "conversation_id": "conversation"},
                ],
            )
            rows_before = connection.execute(sa.select(messages).order_by(messages.c.id)).all()
            indexes_before = sa.inspect(connection).get_indexes("messages")
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            indexes_after = sa.inspect(connection).get_indexes("messages")
            added = next(index for index in indexes_after if index["name"] == _INDEX_NAME)
            assert added["column_names"] == _COLUMNS
            assert not added["unique"]
            assert [index for index in indexes_after if index["name"] != _INDEX_NAME] == indexes_before
            assert connection.execute(sa.select(messages).order_by(messages.c.id)).all() == rows_before
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert sa.inspect(connection).get_indexes("messages") == indexes_before
            assert connection.execute(sa.select(messages).order_by(messages.c.id)).all() == rows_before
    finally:
        engine.dispose()


def test_model_index_matches_migration() -> None:
    """Given model metadata, require the same non-unique lookup columns as the migration."""
    table = Message.__table__
    assert isinstance(table, sa.Table)
    index = next(index for index in table.indexes if index.name == _INDEX_NAME)
    assert [column.name for column in index.columns] == _COLUMNS
    assert not index.unique


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_ddl_uses_concurrent_postgresql_indexes_outside_transactions(dialect: str) -> None:
    """Given a supported dialect, render reversible DDL with the required transaction boundaries."""
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context), context.begin_transaction():
        migration = import_module(_MIGRATION)
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
    columns = ", ".join(_COLUMNS)
    assert "IF NOT EXISTS" not in sql
    assert sql.count("CREATE INDEX") == 1
    assert sql.count("DROP INDEX") == 1
    if dialect == "postgresql":
        for ddl in (
            f"CREATE INDEX CONCURRENTLY {_INDEX_NAME} ON messages ({columns})",
            f"DROP INDEX CONCURRENTLY {_INDEX_NAME}",
        ):
            position = statements.index(ddl)
            assert statements[position - 1] == "COMMIT"
            assert statements[position + 1] == "BEGIN"
    else:
        assert f"CREATE INDEX {_INDEX_NAME} ON messages ({columns})" in statements
        assert f"DROP INDEX {_INDEX_NAME} ON messages" in statements
        assert "CONCURRENTLY" not in sql
