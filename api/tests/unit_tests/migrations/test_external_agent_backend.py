"""Static migration parity plus real SQLite upgrade/backfill/downgrade."""

import importlib.util
import json
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType, TracebackType
from typing import Self

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.engine import Dialect
from sqlalchemy.schema import CreateIndex, CreateTable, SchemaItem

from models.agent import WorkflowAgentNodeBinding
from models.base import TypeBase
from models.types import AdjustedJSON

API = Path(__file__).resolve().parents[3]
MIGRATION = API / "migrations/versions/2026_11_09_1200-c3025a2a1109_add_external_agent_backend.py"


def migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("byoa_migration", MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_real_sqlite_upgrade_preserves_native_rows_and_merges_heads() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    added = {"binding_epoch", "external_job_config", "original_reference"}
    current = WorkflowAgentNodeBinding.__table__
    assert isinstance(current, sa.Table)
    legacy = sa.Table(
        current.name,
        metadata,
        *(
            sa.Column(column.name, column.type, nullable=column.nullable, primary_key=column.primary_key)
            for column in current.columns
            if column.name not in added
        ),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        # Raw SQL represents a pre-upgrade native row and does not involve the
        # new model's Python defaults. Every original column remains unchanged.
        values = {
            "id": "00000000-0000-0000-0000-000000000001",
            "tenant_id": "00000000-0000-0000-0000-000000000002",
            "app_id": "00000000-0000-0000-0000-000000000003",
            "workflow_id": "00000000-0000-0000-0000-000000000004",
            "workflow_version": "draft",
            "node_id": "native-node",
            "binding_type": "reference",
            "node_job_config": "{}",
            "created_at": "2026-11-09 00:00:00",
            "updated_at": "2026-11-09 00:00:00",
        }
        connection.exec_driver_sql(
            f"INSERT INTO {legacy.name} ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
            tuple(values.values()),
        )
        context = MigrationContext.configure(connection, opts={"render_as_batch": True})
        with Operations.context(context):
            migration().upgrade()
        inspector = sa.inspect(connection)
        expected = {name for name in TypeBase.metadata.tables if name.startswith("external_agent_")}
        expected.add("external_workflow_budgets")
        assert expected <= set(inspector.get_table_names())
        for name in expected:
            current = TypeBase.metadata.tables[name]
            assert {column["name"] for column in inspector.get_columns(name)} == set(current.c.keys())
            assert {
                (index["name"], tuple(index["column_names"]), index["unique"]) for index in inspector.get_indexes(name)
            } == {(index.name, tuple(index.columns.keys()), index.unique) for index in current.indexes}
        actual = connection.exec_driver_sql(
            "SELECT node_id, node_job_config, external_job_config, binding_epoch FROM workflow_agent_node_bindings"
        ).one()
        assert actual[0:2] == ("native-node", "{}")
        assert json.loads(actual[2]) == {}
        assert actual[3] is None
        columns = {column["name"]: column for column in inspector.get_columns(legacy.name)}
        assert not columns["external_job_config"]["nullable"]
        assert columns["external_job_config"]["default"] is not None
        old_columns = connection.exec_driver_sql(
            f"SELECT {', '.join(values)} FROM {legacy.name} WHERE node_id = 'native-node'"
        ).one()
        # A still-running old process omits every new column after the upgrade.
        after_values = {**values, "id": "00000000-0000-0000-0000-000000000005", "node_id": "native-after-upgrade"}
        connection.exec_driver_sql(
            f"INSERT INTO {legacy.name} ({', '.join(after_values)}) VALUES ({', '.join('?' for _ in after_values)})",
            tuple(after_values.values()),
        )
        assert (
            json.loads(
                connection.exec_driver_sql(
                    f"SELECT external_job_config FROM {legacy.name} WHERE node_id = 'native-after-upgrade'"
                ).scalar_one()
            )
            == {}
        )
        assert (
            connection.exec_driver_sql(
                f"SELECT {', '.join(values)} FROM {legacy.name} WHERE node_id = 'native-node'"
            ).one()
            == old_columns
        )
        file_columns = {column["name"] for column in inspector.get_columns("external_agent_file_leases")}
        assert {"storage_key", "write_state", "write_lease_until", "cleanup_after", "content_hash"} <= file_columns
        with Operations.context(context):
            migration().downgrade()
        assert sa.inspect(connection).get_table_names() == [legacy.name]
        assert not added.intersection(column["name"] for column in sa.inspect(connection).get_columns(legacy.name))
    engine.dispose()
    assert ScriptDirectory(str(API / "migrations")).get_heads() == ["c3025dflt1112"]


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect()])
def test_static_new_tables_compile_for_supported_server_dialects(
    dialect: Dialect,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
            assert "external_job_config" in statement

    module = migration()
    monkeypatch.setattr(module, "op", DDL())
    module.upgrade()
    assert len(tables) == 17
    for table in tables:
        current = TypeBase.metadata.tables[table.name]
        assert set(table.c.keys()) == set(current.c.keys())
        assert {(index.name, tuple(index.columns.keys()), index.unique) for index in table.indexes} == {
            (index.name, tuple(index.columns.keys()), index.unique) for index in current.indexes
        }
        for column in table.c:
            assert column.nullable == current.c[column.name].nullable
            assert column.primary_key == current.c[column.name].primary_key
