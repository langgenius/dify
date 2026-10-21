import importlib.util
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol, cast

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests, new_app_selection, new_connection

TABLE_NAMES = {"end_user_connections", "app_connections", "session_connections"}


class ConnectionMigration(Protocol):
    op: Operations

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


def load_migration(connection: sa.Connection) -> ConnectionMigration:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_10_21_1000-c91e4a7b2d60_add_end_user_connections.py"
    )
    spec = importlib.util.spec_from_file_location("end_user_connections_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    migration = cast(ConnectionMigration, module)
    migration.op = Operations(MigrationContext.configure(connection))
    return migration


@pytest.fixture
def connection_session() -> Iterator[Session]:
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        load_migration(connection).upgrade()
        connection.commit()
        with Session(connection) as session:
            yield session
    engine.dispose()


class TestMigratedConnections(ConnectionPersistenceTests):
    """Exercise deployed constraints as well as ORM-created tables."""


def test_migration_schema_matches_models(connection_session: Session) -> None:
    metadata = sa.MetaData()
    for model in (EndUserConnection, AppConnection, SessionConnection):
        model.metadata.tables[model.__tablename__].to_metadata(metadata)
    connection = connection_session.connection()
    assert set(sa.inspect(connection).get_table_names()) == TABLE_NAMES
    context = MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True})
    assert compare_metadata(context, metadata) == []

    # Alembic autogeneration does not compare check constraints.
    inspector = sa.inspect(connection)
    for table in metadata.sorted_tables:
        expected_checks = {
            str(constraint.name): str(
                constraint.sqltext.compile(dialect=connection.dialect, compile_kwargs={"literal_binds": True})
            )
            for constraint in table.constraints
            if isinstance(constraint, sa.CheckConstraint)
        }
        assert {
            check["name"]: check["sqltext"] for check in inspector.get_check_constraints(table.name)
        } == expected_checks
        assert inspector.get_pk_constraint(table.name)["name"] == table.primary_key.name


def test_upgrade_downgrade_preserves_workspace_credentials() -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql(
            "CREATE TABLE builtin_tool_providers (id TEXT PRIMARY KEY, encrypted_credentials TEXT)"
        )
        connection.exec_driver_sql("INSERT INTO builtin_tool_providers VALUES ('workspace-credential', 'ciphertext')")
        migration = load_migration(connection)
        migration.upgrade()
        with Session(connection) as session:
            credential = new_connection()
            session.add(credential)
            session.flush()
            session.add(new_app_selection(credential))
            session.flush()
            session.commit()
        migration.downgrade()
        assert sa.inspect(connection).get_table_names() == ["builtin_tool_providers"]
        assert connection.exec_driver_sql("SELECT * FROM builtin_tool_providers").all() == [
            ("workspace-credential", "ciphertext")
        ]
        migration.upgrade()
        assert set(sa.inspect(connection).get_table_names()) == TABLE_NAMES | {"builtin_tool_providers"}
    engine.dispose()
