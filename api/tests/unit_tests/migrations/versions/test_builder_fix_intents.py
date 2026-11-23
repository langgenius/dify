"""Fix intake migration preserves old Run evidence and portable constraints."""

from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, MetaData, String, Table, create_engine, inspect, select

from tests.helpers.builder_migration import load_builder_migration


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_fix_intents_migration_generates_portable_ddl(dialect: str) -> None:
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        load_builder_migration()._create_fix_intents()
        load_builder_migration()._drop_fix_intents()
    assert "CREATE TABLE dify_builder_fix_intents" in output.getvalue()
    assert "ALTER TABLE dify_builder_runs" in output.getvalue()
    assert "DROP TABLE dify_builder_fix_intents" in output.getvalue()


def test_fix_intents_migration_preserves_legacy_failed_runs_through_upgrade_and_downgrade() -> None:
    engine = create_engine("sqlite://")
    metadata = MetaData()
    runs = Table("dify_builder_runs", metadata, Column("id", String, primary_key=True), Column("status", String))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(runs.insert().values(id="original", status="failed"))
        with Operations.context(MigrationContext.configure(connection)):
            load_builder_migration()._create_fix_intents()
            upgraded = Table("dify_builder_runs", MetaData(), autoload_with=connection)
            assert connection.execute(select(upgraded)).one()._asdict() == {
                "id": "original",
                "status": "failed",
                "origin_task_id": None,
            }
            constraints = inspect(connection).get_unique_constraints("dify_builder_fix_intents")
            assert {tuple(constraint["column_names"]) for constraint in constraints} == {
                ("session_id", "client_action_id"),
                ("session_id", "decision_id"),
            }
            load_builder_migration()._drop_fix_intents()
            assert connection.execute(select(runs)).one()._asdict() == {"id": "original", "status": "failed"}
            assert "dify_builder_fix_intents" not in inspect(connection).get_table_names()
    engine.dispose()
