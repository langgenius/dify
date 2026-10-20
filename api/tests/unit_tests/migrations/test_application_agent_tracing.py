"""The migration can create and remove the three tables without business tables."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import event

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
    assert scripts.get_heads() == ["c9e2f4a8b630"]
    steps = scripts._upgrade_revs("b8a7d3f9c621", starting_revision)
    assert steps[-1].revision.revision == "b8a7d3f9c621"
    applied = {step.revision.revision for step in steps}
    sibling = "f7e2c9a6d481" if starting_revision == "a9d4c1e6f823" else "a9d4c1e6f823"
    assert sibling in applied
    assert starting_revision not in applied


def _load_tracing_migration() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_10_15_0330-a17c2980f3e6_add_application_agent_tracing.py"
    )
    spec = importlib.util.spec_from_file_location("application_trace_compatibility_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_legacy_revision_preserves_billing_and_missing_main_ancestors() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    legacy = scripts.get_revision("a17c2980d3e6")
    assert legacy is not None
    assert legacy.down_revision == "a9d4c1e6f823"
    steps = scripts._upgrade_revs("head", legacy.revision)
    applied = [step.revision.revision for step in steps]
    assert set(applied) == {
        "a8c9e2f1b704",
        "f1d3c5b7a902",
        "c6f4a90d8b31",
        "a17c2980f3e6",
        "f7e2c9a6d481",
        "b8a7d3f9c621",
        "c9e2f4a8b630",
    }
    assert applied.index("a8c9e2f1b704") < applied.index("f1d3c5b7a902")
    assert applied.index("f1d3c5b7a902") < applied.index("a17c2980f3e6")
    assert applied[-1] == "c9e2f4a8b630"


def test_current_deployment_only_applies_no_ddl_compatibility_markers() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    steps = scripts._upgrade_revs("head", "b8a7d3f9c621")
    assert [step.revision.revision for step in steps] == ["a17c2980d3e6", "c9e2f4a8b630"]
    for step in steps:
        # Both marker functions must be runnable without an operations context.
        step.revision.module.upgrade()
        step.revision.module.downgrade()


def test_equivalent_existing_tracing_schema_keeps_historical_rows() -> None:
    migration = _load_tracing_migration()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            connection.execute(
                sa.text(
                    "INSERT INTO application_trace_batches "
                    "(id, run_id, invocation_id, payload_hash, spans, final, created_at) "
                    "VALUES ('historical-batch', 'historical-run', 'historical-invocation', "
                    "'hash', '[]', 1, '2026-10-15')"
                )
            )
            before = connection.execute(sa.text("SELECT * FROM application_trace_batches")).all()
            statements = []
            event.listen(
                connection, "before_cursor_execute", lambda _c, _s, sql, _p, _ctx, _many: statements.append(sql)
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            assert connection.execute(sa.text("SELECT * FROM application_trace_batches")).all() == before
            assert not any(
                sql.lstrip().upper().startswith(("CREATE ", "ALTER ", "DROP ", "UPDATE ", "DELETE ", "INSERT "))
                for sql in statements
            )
    finally:
        engine.dispose()


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_offline_tracing_sql_still_creates_canonical_tables(dialect_name: str) -> None:
    migration = _load_tracing_migration()
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect_name, opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration.upgrade()
    sql = output.getvalue()
    assert sql.count("CREATE TABLE application_trace_") == 3
    assert sql.count("CREATE INDEX application_trace_") == 4
    assert "application_trace_source_unique" in sql
    assert not any(word in sql for word in ("IF NOT EXISTS", "DROP TABLE", "UPDATE alembic_version"))


@pytest.mark.parametrize(
    "damage",
    [
        "missing_table",
        "extra_column",
        "wrong_type",
        "nullable",
        "default",
        "index",
        "partial_index",
        "unique",
        "check",
        "view",
    ],
)
def test_incomplete_or_different_existing_schema_is_not_accepted(damage: str) -> None:
    migration = _load_tracing_migration()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            metadata = migration._trace_metadata()
            runs = metadata.tables["application_trace_runs"]
            if damage == "wrong_type":
                runs.c.provider.type = sa.Integer()
            elif damage == "nullable":
                runs.c.provider.nullable = True
            elif damage == "default":
                runs.c.provider.server_default = sa.DefaultClause("unexpected")
            elif damage == "unique":
                for constraint in list(runs.constraints):
                    if isinstance(constraint, sa.UniqueConstraint):
                        runs.constraints.remove(constraint)
            elif damage == "check":
                runs.append_constraint(sa.CheckConstraint("attempts >= 0", name="unexpected"))
            if damage == "view":
                connection.exec_driver_sql("CREATE VIEW application_trace_runs AS SELECT 1 AS id")
            else:
                metadata.create_all(connection)
                if damage == "missing_table":
                    connection.exec_driver_sql("DROP TABLE application_trace_batches")
                elif damage == "extra_column":
                    connection.exec_driver_sql("ALTER TABLE application_trace_runs ADD COLUMN unexpected TEXT")
                elif damage in ("index", "partial_index"):
                    connection.exec_driver_sql("DROP INDEX application_trace_delivery_idx")
                    if damage == "partial_index":
                        connection.exec_driver_sql(
                            "CREATE INDEX application_trace_delivery_idx ON application_trace_runs "
                            "(state, next_attempt_at) WHERE state = 'ready'"
                        )
            schema_before = connection.execute(
                sa.text("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
            ).all()
            with Operations.context(MigrationContext.configure(connection)):
                with pytest.raises(RuntimeError, match="Application tracing schema mismatch"):
                    migration.upgrade()
            assert (
                connection.execute(sa.text("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")).all()
                == schema_before
            )
    finally:
        engine.dispose()


@pytest.mark.parametrize("reflection", ["index_sorting", "primary_key_options"])
def test_noncanonical_reflection_options_are_rejected(reflection: str, monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _load_tracing_migration()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            migration._trace_metadata().create_all(connection)
            inspector = sa.inspect(connection)
            if reflection == "index_sorting":
                get_indexes = inspector.get_indexes
                indexes = get_indexes("application_trace_runs")
                # PostgreSQL reports DESC / NULLS ordering separately from dialect_options.
                indexes[0]["column_sorting"] = {"state": ("desc",)}
                monkeypatch.setattr(
                    inspector,
                    "get_indexes",
                    lambda table: indexes if table == "application_trace_runs" else get_indexes(table),
                )
            else:
                get_primary_key = inspector.get_pk_constraint
                primary_key = get_primary_key("application_trace_runs")
                primary_key["dialect_options"] = {"postgresql_include": ["provider"]}
                monkeypatch.setattr(
                    inspector,
                    "get_pk_constraint",
                    lambda table: primary_key if table == "application_trace_runs" else get_primary_key(table),
                )
            monkeypatch.setattr(migration.sa, "inspect", lambda _connection: inspector)
            with Operations.context(MigrationContext.configure(connection)):
                with pytest.raises(RuntimeError, match="Application tracing schema mismatch"):
                    migration.upgrade()
    finally:
        engine.dispose()
