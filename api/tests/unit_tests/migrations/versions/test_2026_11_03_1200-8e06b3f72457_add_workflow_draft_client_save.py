"""The unload-save receipt migrates without changing existing workflow graphs."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, MetaData, String, Table, create_engine, inspect, select


def _migration() -> ModuleType:
    path = (
        Path(__file__).parents[4] / "migrations/versions/2026_11_03_1200-8e06b3f72457_add_workflow_draft_client_save.py"
    )
    spec = importlib.util.spec_from_file_location("workflow_draft_client_save_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_receipt_migration_renders_for_supported_databases(dialect: str) -> None:
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        _migration().upgrade()
        _migration().downgrade()
    sql = output.getvalue()
    for column in ("draft_client_save_id", "draft_client_save_account_id", "draft_client_save_hash"):
        assert f"ADD COLUMN {column}" in sql
        assert f"DROP COLUMN {column}" in sql


def test_receipt_upgrade_and_downgrade_preserve_existing_workflow() -> None:
    engine = create_engine("sqlite://")
    metadata = MetaData()
    workflows = Table("workflows", metadata, Column("id", String, primary_key=True), Column("graph", String))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(workflows.insert().values(id="existing", graph='{"nodes": [], "edges": []}'))
        with Operations.context(MigrationContext.configure(connection)):
            _migration().upgrade()
            upgraded = Table("workflows", MetaData(), autoload_with=connection)
            assert connection.execute(select(upgraded)).one()._asdict() == {
                "id": "existing",
                "graph": '{"nodes": [], "edges": []}',
                "draft_client_save_id": None,
                "draft_client_save_account_id": None,
                "draft_client_save_hash": None,
            }
            _migration().downgrade()
            assert {column["name"] for column in inspect(connection).get_columns("workflows")} == {"id", "graph"}
            assert connection.execute(select(workflows)).one()._asdict() == {
                "id": "existing",
                "graph": '{"nodes": [], "edges": []}',
            }
    engine.dispose()
