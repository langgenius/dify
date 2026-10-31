"""Fix intake migration preserves old Run evidence and portable constraints."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, MetaData, String, Table, create_engine, inspect, select


def migration() -> ModuleType:
    path = Path(__file__).parents[4] / "migrations/versions/2026_10_30_1500-6c84f1d90235_builder_fix_intents.py"
    spec = importlib.util.spec_from_file_location("builder_fix_intents_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_fix_intents_migration_generates_portable_ddl(dialect: str) -> None:
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        migration().upgrade()
        migration().downgrade()
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
            migration().upgrade()
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
            migration().downgrade()
            assert connection.execute(select(runs)).one()._asdict() == {"id": "original", "status": "failed"}
            assert "dify_builder_fix_intents" not in inspect(connection).get_table_names()
    engine.dispose()
