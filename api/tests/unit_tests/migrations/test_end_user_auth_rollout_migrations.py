"""Verify transaction boundaries in the offline End User rollout SQL."""

from importlib import import_module
from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

_LINK = "2026_10_16_1000-b27e8d49a103_link_browser_end_users_to_accounts"
_CONSUMER_INDEXES = "2026_10_30_1600-b73e9c40a215_add_consumer_execution_indexes"
_BUILDER_ORIGIN = "2026_11_03_1000-b43e8c1d9a72_record_builder_workspace_origin"


def _render(migration_name: str, dialect: str) -> tuple[str, str]:
    """Render each direction without a database; the declared start schema must match each direction."""
    migration = import_module(f"migrations.versions.{migration_name}")
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context), context.begin_transaction():
        migration.upgrade()
    up = output.getvalue()
    output.seek(0)
    output.truncate()
    with Operations.context(context), context.begin_transaction():
        migration.downgrade()
    return up, output.getvalue()


def test_account_unique_index_is_built_between_short_schema_changes() -> None:
    """Commit adding the link before scanning the existing EndUser table."""
    up, down = _render(_LINK, "postgresql")
    expected = (
        "ALTER TABLE end_users ADD COLUMN account_id UUID",
        "CREATE UNIQUE INDEX CONCURRENTLY end_user_app_account_key ON end_users (tenant_id, app_id, type, account_id)",
        "ALTER TABLE end_users ADD CONSTRAINT end_user_app_account_key UNIQUE USING INDEX end_user_app_account_key",
    )
    assert "IF NOT EXISTS" not in up
    statements = [statement.strip() for statement in up.split(";") if statement.strip()]
    assert [statements.index(ddl) for ddl in expected] == sorted(statements.index(ddl) for ddl in expected)
    for ddl in expected:
        position = statements.index(ddl)
        assert statements[position - 1] == "COMMIT"
        assert statements[position + 1] == "BEGIN"
    assert "ALTER TABLE end_users DROP CONSTRAINT end_user_app_account_key, DROP COLUMN account_id;" in down


def test_consumer_indexes_have_independent_concurrent_builds_and_drops() -> None:
    """Expect each PostgreSQL build and drop outside a transaction."""
    up, down = _render(_CONSUMER_INDEXES, "postgresql")
    for sql, operation in ((up, "CREATE INDEX CONCURRENTLY"), (down, "DROP INDEX CONCURRENTLY")):
        statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
        positions = [index for index, stmt in enumerate(statements) if stmt.startswith(operation)]
        assert len(positions) == 2
        for position in positions:
            assert statements[position - 1] == "COMMIT"
            assert statements[position + 1] == "BEGIN"


def test_postgresql_builder_backfill_runs_outside_the_schema_transaction() -> None:
    """Add the nullable column with autocommit and run the internally committing backfill next."""
    up, down = _render(_BUILDER_ORIGIN, "postgresql")
    assert "COMMIT;\n\nALTER TABLE accounts ADD COLUMN first_workspace_created_at TIMESTAMP WITHOUT TIME ZONE;" in up
    assert "TIMESTAMP WITHOUT TIME ZONE;\n\nDO $builder_origin$" in up
    assert "LIMIT 1000" in up
    assert "after_id := batch_ids[cardinality(batch_ids)];\n        COMMIT;" in up
    assert "WHERE account.id = origins.id AND account.first_workspace_created_at IS NULL" in up
    assert "COMMIT;\n\nALTER TABLE accounts DROP COLUMN first_workspace_created_at;" in down


@pytest.mark.parametrize("migration_name", [_LINK, _CONSUMER_INDEXES, _BUILDER_ORIGIN])
def test_mysql_renders_portable_schema_and_data_changes(migration_name: str) -> None:
    """Keep PostgreSQL-only DDL and DO out of MySQL's offline scripts."""
    up, down = _render(migration_name, "mysql")
    assert "CONCURRENTLY" not in up + down
    assert "USING INDEX" not in up + down
    assert "DO $builder_origin$" not in up
    assert "ALTER TABLE" in up or "CREATE INDEX" in up
    assert "DROP" in down
    if migration_name == _BUILDER_ORIGIN:
        assert "UPDATE accounts SET first_workspace_created_at=" in up
        assert "accounts.first_workspace_created_at IS NULL" in up
