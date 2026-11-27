"""The first public BYOA revision is complete, reversible and Native-writer compatible."""

import ast
import importlib.util
import io
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import ModuleType, TracebackType
from typing import Self

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.engine import Dialect
from sqlalchemy.schema import CreateIndex, CreateTable, SchemaItem

from models.agent import WorkflowAgentNodeBinding
from models.base import TypeBase
from models.types import AdjustedJSON

API = Path(__file__).resolve().parents[3]
MIGRATION = API / "migrations/versions/2026_11_24_1200-c3025byoa1124_add_external_agent_backend.py"
REVISION = "c3025byoa1124"
UPSTREAM_HEAD = "f8b6e2c4a901"
NEW_COLUMNS = frozenset({"binding_epoch", "external_job_config", "original_reference"})
DEVELOPMENT_REVISIONS = frozenset(
    {
        "c3025a2a1109",
        "c3025dflt1112",
        "c3025merge1112",
        "c3046merge1115",
        "c3051merge1117",
        "c3056cap1120",
        "c3056merge1120",
    }
)


def migration() -> ModuleType:
    """Load the actual revision without importing application orchestration."""
    spec = importlib.util.spec_from_file_location("byoa_migration", MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def managed_tables() -> dict[str, sa.Table]:
    """Return the final ORM schema that the first public migration must create."""
    return {
        name: table
        for name, table in TypeBase.metadata.tables.items()
        if name.startswith("external_agent_") or name == "external_workflow_budgets"
    }


def native_values(*, suffix: str, node: str) -> dict[str, str]:
    """Represent a raw pre-BYOA writer; no Python model default can fill new columns."""
    return {
        "id": "00000000-0000-0000-0000-" + suffix,
        "tenant_id": "00000000-0000-0000-0000-000000000002",
        "app_id": "00000000-0000-0000-0000-000000000003",
        "workflow_id": "00000000-0000-0000-0000-000000000004",
        "workflow_version": "draft",
        "node_id": node,
        "binding_type": "reference",
        "current_snapshot_id": "00000000-0000-0000-0000-000000000006",
        "node_job_config": '{"task":"Native content remains unchanged"}',
        "created_at": "2026-11-24 00:00:00",
        "updated_at": "2026-11-24 00:00:00",
    }


def insert_values(connection: sa.Connection, table: str, values: Mapping[str, str | int]) -> None:
    """Insert bound test values into a test-owned, statically selected table."""
    connection.execute(
        sa.text(f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join(':' + name for name in values)})"),
        values,
    )


def legacy_binding_table() -> sa.Table:
    """Model existing Native columns and an index/constraint that ALTER must preserve."""
    current = WorkflowAgentNodeBinding.__table__
    assert isinstance(current, sa.Table)
    table = sa.Table(
        current.name,
        sa.MetaData(),
        *(
            sa.Column(column.name, column.type, nullable=column.nullable, primary_key=column.primary_key)
            for column in current.columns
            if column.name not in NEW_COLUMNS
        ),
        sa.UniqueConstraint("workflow_id", "node_id", name="native_binding_workflow_node_uq"),
    )
    sa.Index("native_binding_owner_node_idx", table.c.tenant_id, table.c.node_id)
    return table


def assert_final_schema(connection: sa.Connection) -> None:
    """Check final columns and ownership constraints, including nullable consent evidence."""
    expected = managed_tables()
    assert len(expected) == 17
    inspector = sa.inspect(connection)
    assert set(inspector.get_table_names()) == {*expected, "workflow_agent_node_bindings"}
    for name, table in expected.items():
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        assert set(columns) == set(table.c.keys())
        assert {name: column["nullable"] for name, column in columns.items()} == {
            column.name: column.nullable for column in table.c
        }
        assert set(inspector.get_pk_constraint(name)["constrained_columns"]) == set(table.primary_key.columns.keys())
        assert {
            (index["name"], tuple(index["column_names"]), index["unique"]) for index in inspector.get_indexes(name)
        } == {(index.name, tuple(index.columns.keys()), index.unique) for index in table.indexes}
        assert {
            (constraint["name"], tuple(constraint["column_names"]))
            for constraint in inspector.get_unique_constraints(name)
        } == {
            (constraint.name, tuple(constraint.columns.keys()))
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
    binding_columns = {column["name"]: column for column in inspector.get_columns("workflow_agent_node_bindings")}
    assert not binding_columns["external_job_config"]["nullable"]
    assert binding_columns["external_job_config"]["default"] is not None
    policy = next(
        column for column in inspector.get_columns("external_agent_trace_targets") if column["name"] == "capture_policy"
    )
    assert policy["nullable"]
    assert policy["default"] is None


def test_sqlite_upgrade_downgrade_reupgrade_preserves_native_rows_and_indexes(tmp_path: Path) -> None:
    """Real SQL preserves old data/writers and restores the predecessor on downgrade."""
    engine = sa.create_engine(sa.URL.create("sqlite", database=str(tmp_path / "external-agent-migration.db")))
    legacy = legacy_binding_table()
    legacy.metadata.create_all(engine)
    with engine.begin() as connection:
        before = native_values(suffix="000000000001", node="existing-native")
        insert_values(connection, legacy.name, before)
        original = connection.exec_driver_sql(f"SELECT {', '.join(before)} FROM {legacy.name}").one()
        context = MigrationContext.configure(connection, opts={"render_as_batch": True})
        with Operations.context(context):
            migration().upgrade()
        assert_final_schema(connection)
        assert connection.exec_driver_sql(f"SELECT {', '.join(before)} FROM {legacy.name}").one() == original
        backfilled = connection.exec_driver_sql(
            "SELECT external_job_config, binding_epoch, original_reference FROM workflow_agent_node_bindings"
        ).one()
        assert json.loads(backfilled[0]) == {}
        assert backfilled[1:] == (None, None)
        after = native_values(suffix="000000000005", node="rolling-native")
        insert_values(connection, legacy.name, after)
        assert (
            json.loads(
                connection.exec_driver_sql(
                    "SELECT external_job_config FROM workflow_agent_node_bindings WHERE node_id='rolling-native'"
                ).scalar_one()
            )
            == {}
        )
        # Frozen evidence starts unknown even when a rolling writer reports a
        # true/false capture flag. There is no synthesized consent or default {}.
        for sequence, capture_content in enumerate((0, 1), start=1):
            insert_values(
                connection,
                "external_agent_trace_targets",
                {
                    "id": f"00000000-0000-0000-0000-{sequence:012}",
                    "tenant_id": before["tenant_id"],
                    "invocation_id": f"00000000-0000-0000-0001-{sequence:012}",
                    "target_kind": "asset",
                    "target_id": before["id"],
                    "provider": "langfuse",
                    "config_revision": "1",
                    "encrypted_config": "{}",
                    "capture_content": capture_content,
                },
            )
        assert connection.exec_driver_sql(
            "SELECT capture_content, capture_policy FROM external_agent_trace_targets ORDER BY id"
        ).all() == [(0, None), (1, None)]
        with Operations.context(context):
            migration().downgrade()
        inspector = sa.inspect(connection)
        assert inspector.get_table_names() == [legacy.name]
        assert not NEW_COLUMNS.intersection(column["name"] for column in inspector.get_columns(legacy.name))
        assert {index["name"] for index in inspector.get_indexes(legacy.name)} == {"native_binding_owner_node_idx"}
        assert {item["name"] for item in inspector.get_unique_constraints(legacy.name)} == {
            "native_binding_workflow_node_uq"
        }
        native_snapshot = connection.exec_driver_sql(f"SELECT * FROM {legacy.name} ORDER BY node_id").all()
        assert len(native_snapshot) == 2
        with Operations.context(context):
            migration().upgrade()
        assert_final_schema(connection)
        assert (
            connection.exec_driver_sql(f"SELECT {', '.join(legacy.c.keys())} FROM {legacy.name} ORDER BY node_id").all()
            == native_snapshot
        )
    engine.dispose()


def test_revision_is_one_nonempty_child_of_the_existing_main_head() -> None:
    """Unreleased development merge nodes do not enter the public revision graph."""
    scripts = ScriptDirectory(str(API / "migrations"))
    assert scripts.get_heads() == [REVISION]
    current = scripts.get_revision(REVISION)
    assert current is not None
    assert current.down_revision == UPSTREAM_HEAD
    assert not DEVELOPMENT_REVISIONS.intersection(revision.revision for revision in scripts.walk_revisions())
    # Upstream's existing merge history remains untouched.
    parent = scripts.get_revision(UPSTREAM_HEAD)
    assert parent is not None
    assert parent.down_revision == ("8c2f5d7a1e30", "c7e4a1b2d9f0")
    functions = [node for node in ast.parse(MIGRATION.read_text()).body if isinstance(node, ast.FunctionDef)]
    assert {function.name for function in functions} == {"upgrade", "downgrade"}
    assert not any(isinstance(node, ast.Pass) for function in functions for node in ast.walk(function))


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect()])
def test_static_final_tables_match_models_for_supported_server_dialects(
    dialect: Dialect,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The complete declared DDL is portable and matches every final model column."""
    metadata = sa.MetaData()
    tables: list[sa.Table] = []

    class Batch:
        def __enter__(self) -> Self:
            return self

        def __exit__(
            self, exc_type: type[BaseException] | None, exc_value: BaseException | None, traceback: TracebackType | None
        ) -> bool:
            del exc_type, exc_value, traceback
            return False

        def add_column(self, column: sa.Column[object]) -> None:
            compiled = str(sa.schema.CreateColumn(column).compile(dialect=dialect))
            if column.name == "external_job_config":
                assert column.server_default is not None
                assert "DEFAULT ('{}')" in compiled

        def alter_column(self, name: str, *, nullable: bool, existing_type: object, server_default: object) -> None:
            assert name == "external_job_config"
            assert nullable is False
            assert isinstance(existing_type, AdjustedJSON)
            assert str(server_default) == "('{}')"

    class DDL:
        def create_table(self, name: str, *items: SchemaItem) -> None:
            table = sa.Table(name, metadata, *items)
            str(CreateTable(table).compile(dialect=dialect))
            tables.append(table)

        def create_index(self, name: str, table_name: str, columns: Sequence[str], unique: bool = False) -> None:
            index = sa.Index(name, *(metadata.tables[table_name].c[column] for column in columns), unique=unique)
            str(CreateIndex(index).compile(dialect=dialect))

        def batch_alter_table(self, name: str) -> Batch:
            assert name == "workflow_agent_node_bindings"
            return Batch()

        def execute(self, statement: str) -> None:
            assert statement == (
                "UPDATE workflow_agent_node_bindings SET external_job_config = '{}' WHERE external_job_config IS NULL"
            )

    module = migration()
    monkeypatch.setattr(module, "op", DDL())
    module.upgrade()
    assert len(tables) == 17
    assert sum(len(table.indexes) for table in tables) == 18
    assert (
        sum(isinstance(constraint, sa.UniqueConstraint) for table in tables for constraint in table.constraints) == 10
    )
    for table in tables:
        current = TypeBase.metadata.tables[table.name]
        assert set(table.c.keys()) == set(current.c.keys())
        assert set(table.primary_key.columns.keys()) == set(current.primary_key.columns.keys())
        assert {
            (constraint.name, tuple(constraint.columns.keys()))
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        } == {
            (constraint.name, tuple(constraint.columns.keys()))
            for constraint in current.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        for column in table.c:
            expected = current.c[column.name]
            assert column.nullable == expected.nullable
            assert column.primary_key == expected.primary_key
            assert column.type.compile(dialect=dialect) == expected.type.compile(dialect=dialect)
        assert {(index.name, tuple(index.columns.keys()), index.unique) for index in table.indexes} == {
            (index.name, tuple(index.columns.keys()), index.unique) for index in current.indexes
        }
    policy = metadata.tables["external_agent_trace_targets"].c.capture_policy
    assert policy.nullable
    assert policy.server_default is None


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect()])
def test_real_offline_ddl_preserves_json_default_through_not_null(dialect: Dialect) -> None:
    """Actual Alembic rendering retains the old-writer default on both ALTER steps."""
    output = io.StringIO()
    with Operations.context(
        MigrationContext.configure(dialect=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        migration().upgrade()
        migration().downgrade()
    rendered = output.getvalue()
    assert "capture_policy" in rendered
    assert "external_job_config" in rendered
    assert rendered.count("('{}')") == 2
    assert "UPDATE workflow_agent_node_bindings SET external_job_config = '{}'" in rendered
    if dialect.name == "mysql":
        assert "MODIFY external_job_config JSON NOT NULL DEFAULT ('{}')" in rendered
    else:
        assert "ALTER COLUMN external_job_config SET DEFAULT ('{}')" in rendered


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect(), sqlite.dialect()])
def test_model_default_is_the_same_portable_json_expression(dialect: Dialect) -> None:
    current = WorkflowAgentNodeBinding.__table__
    assert isinstance(current, sa.Table)
    column = current.c.external_job_config
    assert column.server_default is not None
    assert "DEFAULT ('{}')" in str(sa.schema.CreateColumn(column).compile(dialect=dialect))
    assert WorkflowAgentNodeBinding.__dataclass_fields__["external_job_config"].default_factory is dict
