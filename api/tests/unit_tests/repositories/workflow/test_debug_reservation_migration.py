"""The new lease ledger never inspects or rewrites existing execution history."""

import importlib.util
from collections.abc import Mapping, Sequence
from pathlib import Path
from uuid import UUID

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event
from sqlalchemy.engine import Connection, ExecutionContext
from sqlalchemy.engine.interfaces import DBAPICursor

type DriverParameters = Mapping[str, object] | Sequence[object] | None


def test_debug_lease_migration_changes_schema_without_accessing_history() -> None:
    path = (
        Path(__file__).parents[4]
        / "migrations/versions/2026_10_06_1200-a4f6c8d2e901_index_workflow_debug_reservations.py"
    )
    spec = importlib.util.spec_from_file_location("debug_lease_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    upgrade = migration.__dict__.get("upgrade")
    downgrade = migration.__dict__.get("downgrade")
    assert callable(upgrade)
    assert callable(downgrade)
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE workflow_runs (id VARCHAR(36) PRIMARY KEY, graph TEXT)")
            history = [{"id": str(UUID(int=i + 1)), "graph": '{"nodes": [], "edges": []}'} for i in range(1_003)]
            connection.execute(sa.text("INSERT INTO workflow_runs VALUES (:id, :graph)"), history)
            statements: list[str] = []

            def record_statement(
                _connection: Connection,
                _cursor: DBAPICursor,
                statement: str,
                _params: DriverParameters,
                _context: ExecutionContext | None,
                _many: bool,
            ) -> None:
                statements.append(statement.strip().upper())

            event.listen(connection, "before_cursor_execute", record_statement)
            with Operations.context(MigrationContext.configure(connection)):
                upgrade()
            assert all(sql.startswith(("CREATE TABLE", "CREATE INDEX")) for sql in statements)
            event.remove(connection, "before_cursor_execute", record_statement)
            inspector = sa.inspect(connection)
            assert inspector.get_indexes("workflow_debug_reservations")[0]["column_names"] == [
                "expires_at",
                "workflow_run_id",
            ]
            foreign_key = inspector.get_foreign_keys("workflow_debug_reservations")[0]
            assert foreign_key["referred_table"] == "workflow_runs"
            assert foreign_key["options"]["ondelete"] == "CASCADE"
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM workflow_debug_reservations")) == 0
            # Downgrade must also avoid rewriting a graph, including outstanding reservations.
            connection.execute(
                sa.text("INSERT INTO workflow_debug_reservations (workflow_run_id) VALUES (:id)"),
                {"id": history[0]["id"]},
            )
            statements.clear()
            event.listen(connection, "before_cursor_execute", record_statement)
            with Operations.context(MigrationContext.configure(connection)):
                downgrade()
            assert statements == ["DROP TABLE WORKFLOW_DEBUG_RESERVATIONS"]
            event.remove(connection, "before_cursor_execute", record_statement)
            assert not sa.inspect(connection).has_table("workflow_debug_reservations")
            assert list(connection.execute(sa.text("SELECT id, graph FROM workflow_runs")).mappings()) == history
    finally:
        engine.dispose()
