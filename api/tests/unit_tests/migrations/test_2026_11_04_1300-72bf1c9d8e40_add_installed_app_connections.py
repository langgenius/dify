"""Workspace member selections have portable, reversible persistence."""

from importlib import import_module

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Engine, create_mock_engine

from models.installed_app_connection import InstalledAppConnectionConfiguration

MIGRATION = "migrations.versions.2026_11_04_1300-72bf1c9d8e40_add_installed_app_connections"


def test_migration_matches_model_and_downgrades(sqlite_engine: Engine) -> None:
    migration = import_module(MIGRATION)
    table = InstalledAppConnectionConfiguration.__table__
    with sqlite_engine.begin() as connection:
        table.drop(connection)
        context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_name": lambda name, type_, _parents: type_ != "table" or name == table.name,
            },
        )
        with Operations.context(context):
            migration.upgrade()
        metadata = sa.MetaData()
        table.to_metadata(metadata)
        assert compare_metadata(context, metadata) == []
        with Operations.context(context):
            migration.downgrade()
        assert not sa.inspect(connection).has_table(table.name)


@pytest.mark.parametrize("dialect", ["postgresql", "mysql", "sqlite"])
def test_schema_compiles_for_supported_dialects(dialect: str) -> None:
    statements = []
    engine = create_mock_engine(f"{dialect}://", lambda statement, *_args, **_kwargs: statements.append(statement))
    with Operations.context(MigrationContext.configure(engine)):
        import_module(MIGRATION).upgrade()
        import_module(MIGRATION).downgrade()
    sql = "\n".join(str(statement.compile(dialect=engine.dialect)) for statement in statements)
    assert "installed_connection_owner_key" in sql
    assert "DROP TABLE installed_app_connection_configurations" in sql
