import importlib.util
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol, cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevision,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests, new_app_selection, new_connection

FEATURE_MIGRATION = "2026_10_26_1300-f3a6b9c2d108_add_connection_revision_contracts.py"
CONFIGURATION_MIGRATION = "2026_10_29_1200-a91d5e7c3b20_save_connection_authorizations.py"
TABLE_NAMES = {
    "end_user_connections",
    "app_connections",
    "session_connections",
    "end_user_connection_revisions",
    "end_user_connection_revision_acceptances",
}


class ConnectionMigration(Protocol):
    op: Operations

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


def load_migration(
    connection: sa.Connection, filename: str = "2026_10_21_1000-c91e4a7b2d60_add_end_user_connections.py"
) -> ConnectionMigration:
    path = Path(__file__).resolve().parents[3] / "migrations/versions" / filename
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
        load_migration(connection, FEATURE_MIGRATION).upgrade()
        load_migration(connection, CONFIGURATION_MIGRATION).upgrade()
        connection.commit()
        with Session(connection) as session:
            yield session
    engine.dispose()


class TestMigratedConnections(ConnectionPersistenceTests):
    """Exercise deployed constraints as well as ORM-created tables."""


def test_migration_schema_matches_models(connection_session: Session) -> None:
    metadata = sa.MetaData()
    for model in (
        EndUserConnection,
        AppConnection,
        SessionConnection,
        EndUserConnectionRevision,
        EndUserConnectionRevisionAcceptance,
    ):
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
        provenance = load_migration(connection, FEATURE_MIGRATION)
        provenance.upgrade()
        configuration = load_migration(connection, CONFIGURATION_MIGRATION)
        configuration.upgrade()
        with Session(connection) as session:
            credential = new_connection()
            session.add(credential)
            session.flush()
            session.add(new_app_selection(credential))
            session.flush()
            session.commit()
        configuration.downgrade()
        provenance.downgrade()
        migration.downgrade()
        assert sa.inspect(connection).get_table_names() == ["builtin_tool_providers"]
        assert connection.exec_driver_sql("SELECT * FROM builtin_tool_providers").all() == [
            ("workspace-credential", "ciphertext")
        ]
        migration.upgrade()
        provenance.upgrade()
        configuration.upgrade()
        assert set(sa.inspect(connection).get_table_names()) == TABLE_NAMES | {"builtin_tool_providers"}
    engine.dispose()


def test_revision_migration_preserves_legacy_connection_data() -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        load_migration(connection).upgrade()
        table = sa.Table("end_user_connections", sa.MetaData(), autoload_with=connection)
        record = new_connection()
        connection.execute(
            sa.insert(table).values({column.name: getattr(record, column.name) for column in table.columns})
        )
        before = connection.execute(sa.select(table)).mappings().one()
        migration = load_migration(connection, FEATURE_MIGRATION)
        migration.upgrade()
        migrated = sa.Table("end_user_connections", sa.MetaData(), autoload_with=connection)
        after = connection.execute(sa.select(migrated)).mappings().one()
        assert after["oauth_client_fingerprint"] is None
        assert after["oauth_plugin_unique_identifier"] is None
        assert {key: after[key] for key in before} == before
        migration.downgrade()
        assert connection.execute(sa.select(table)).mappings().one() == before
    engine.dispose()


def test_configuration_migration_removes_run_dependency_and_preserves_choices() -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        load_migration(connection).upgrade()
        load_migration(connection, FEATURE_MIGRATION).upgrade()
        credential = new_connection()
        legacy = new_app_selection(credential)
        credentials = sa.Table("end_user_connections", sa.MetaData(), autoload_with=connection)
        defaults = sa.Table("app_connections", sa.MetaData(), autoload_with=connection)
        credential_values = {column.name: getattr(credential, column.name) for column in credentials.columns}
        legacy_values = {
            column.name: getattr(legacy, column.name) for column in defaults.columns if column.name != "source_run_id"
        }
        connection.execute(sa.insert(credentials).values(credential_values))
        connection.execute(sa.insert(defaults).values({**legacy_values, "source_run_id": str(uuid4())}))
        migration = load_migration(connection, CONFIGURATION_MIGRATION)
        migration.upgrade()
        defaults = sa.Table("app_connections", sa.MetaData(), autoload_with=connection)
        assert "source_run_id" not in defaults.c
        assert dict(connection.execute(sa.select(defaults)).mappings().one()) == legacy_values
        saved = new_app_selection(credential)
        saved.node_id = "new-selection"
        connection.execute(
            sa.insert(defaults).values({column.name: getattr(saved, column.name) for column in defaults.columns})
        )
        assert connection.scalar(sa.select(sa.func.count()).select_from(defaults)) == 2
        migration.downgrade()
        restored = sa.Table("app_connections", sa.MetaData(), autoload_with=connection)
        assert not restored.c.source_run_id.nullable
        assert connection.scalar(sa.select(sa.func.count()).select_from(restored)) == 0
        assert dict(connection.execute(sa.select(credentials)).mappings().one()) == credential_values
    engine.dispose()
