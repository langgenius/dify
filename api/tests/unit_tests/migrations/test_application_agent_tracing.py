"""The migration can create and remove the three tables without business tables."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun


@pytest.mark.parametrize(
    ("starting_revision", "required_revisions"),
    [
        ("f1d3c5b7a902", ("a17c2980f3e6", "c6f4a90d8b31", "f7e2c9a6d481")),
        ("a17c2980f3e6", ("c6f4a90d8b31", "f7e2c9a6d481")),
        ("c6f4a90d8b31", ("a17c2980f3e6", "f7e2c9a6d481")),
    ],
)
def test_tracing_and_workflow_pause_upgrade_paths_join(
    starting_revision: str, required_revisions: tuple[str, ...]
) -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    merge = scripts.get_revision("f7e2c9a6d481")
    assert merge is not None
    assert isinstance(merge.down_revision, tuple)
    assert set(merge.down_revision) == {"a17c2980f3e6", "c6f4a90d8b31"}

    # Use Alembic's upgrade planner so either already-applied branch still runs
    # its missing sibling before the merge, without rewriting either migration.
    steps = scripts._upgrade_revs(merge.revision, starting_revision)
    assert {step.revision.revision for step in steps} == set(required_revisions)
    assert steps[-1].revision.revision == merge.revision


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


@pytest.mark.parametrize("starting_revision", ["a9d4c1e6f823", "f7e2c9a6d481"])
def test_deployment_and_tracing_upgrade_paths_join(starting_revision: str) -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    assert scripts.get_heads() == ["b8a7d3f9c621"]
    steps = scripts._upgrade_revs("head", starting_revision)
    assert steps[-1].revision.revision == "b8a7d3f9c621"
    applied = {step.revision.revision for step in steps}
    sibling = "f7e2c9a6d481" if starting_revision == "a9d4c1e6f823" else "a9d4c1e6f823"
    assert sibling in applied
    assert starting_revision not in applied
