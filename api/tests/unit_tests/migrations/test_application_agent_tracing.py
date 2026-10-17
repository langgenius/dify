"""The migration can create and remove the three tables without business tables."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun


def test_application_trace_migration_matches_models_and_roundtrips() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_10_15_0330-a17c2980f3e6_add_application_agent_tracing.py"
    )
    spec = importlib.util.spec_from_file_location("application_trace_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "f1d3c5b7a902"
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            inspector = sa.inspect(connection)
            for model in (ApplicationTraceRun, ApplicationTraceInvocation, ApplicationTraceBatch):
                actual = {column["name"]: column for column in inspector.get_columns(model.__tablename__)}
                assert set(actual) == set(model.__table__.columns.keys())
                for column in model.__table__.columns:
                    assert actual[column.name]["nullable"] == column.nullable
            assert {index["name"] for index in inspector.get_indexes("application_trace_runs")} == {
                "application_trace_delivery_idx",
                "application_trace_retention_idx",
            }
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert sa.inspect(connection).get_table_names() == []
    finally:
        engine.dispose()
