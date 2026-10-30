"""Material DDL uses portable types and creates actual SQLite constraints."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect


def migration() -> ModuleType:
    path = Path(__file__).parents[4] / "migrations/versions/2026_10_29_1100-4a62d9b7e013_builder_material.py"
    spec = importlib.util.spec_from_file_location("builder_material_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_material_migration_is_portable(dialect: str) -> None:
    module = migration()
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        module.upgrade()
        module.downgrade()
    assert "CREATE TABLE dify_builder_material" in output.getvalue()
    assert "DROP TABLE dify_builder_material" in output.getvalue()
    assert module.down_revision == "3f51c8a6d902"


def test_material_migration_applies_and_reverts_native_constraints() -> None:
    module = migration()
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            unique = {
                tuple(item["column_names"])
                for item in inspect(connection).get_unique_constraints("dify_builder_material")
            }
            assert unique == {("session_id", "client_turn_id"), ("session_id", "seq")}
            module.downgrade()
            assert "dify_builder_material" not in inspect(connection).get_table_names()
    engine.dispose()
