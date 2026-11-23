"""Material DDL uses portable types and creates actual SQLite constraints."""

from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect

from tests.helpers.builder_migration import load_builder_migration


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_material_migration_is_portable(dialect: str) -> None:
    module = load_builder_migration()
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        module._create_material_receipts()
        module._drop_material_receipts()
    assert "CREATE TABLE dify_builder_material" in output.getvalue()
    assert "DROP TABLE dify_builder_material" in output.getvalue()


def test_material_migration_applies_and_reverts_native_constraints() -> None:
    module = load_builder_migration()
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module._create_material_receipts()
            unique = {
                tuple(item["column_names"])
                for item in inspect(connection).get_unique_constraints("dify_builder_material")
            }
            assert unique == {("session_id", "client_turn_id"), ("session_id", "seq")}
            module._drop_material_receipts()
            assert "dify_builder_material" not in inspect(connection).get_table_names()
    engine.dispose()
