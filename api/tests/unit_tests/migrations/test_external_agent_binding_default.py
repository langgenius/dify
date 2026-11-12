"""Real SQL keeps pre-BYOA writers and already-applied binding data compatible."""

import importlib.util
import io
import json
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.engine import Dialect
from sqlalchemy.exc import IntegrityError

from models.agent import WorkflowAgentNodeBinding

API = Path(__file__).resolve().parents[3]
REPAIR = API / "migrations/versions/2026_11_12_1200-c3025dflt1112_default_external_agent_binding_job_config.py"
NEW_COLUMNS = frozenset({"binding_epoch", "external_job_config", "original_reference"})


def repair_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("byoa_binding_default_repair", REPAIR)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def historical_binding_table() -> sa.Table:
    """Model the already-applied old c3025 schema, including its missing default."""
    current = WorkflowAgentNodeBinding.__table__
    assert isinstance(current, sa.Table)
    return sa.Table(
        current.name,
        sa.MetaData(),
        *(
            sa.Column(column.name, column.type, nullable=column.nullable, primary_key=column.primary_key)
            for column in current.columns
        ),
    )


def native_values(*, suffix: str, node: str) -> dict[str, str]:
    return {
        "id": "00000000-0000-0000-0000-" + suffix,
        "tenant_id": "00000000-0000-0000-0000-000000000002",
        "app_id": "00000000-0000-0000-0000-000000000003",
        "workflow_id": "00000000-0000-0000-0000-000000000004",
        "workflow_version": "draft",
        "node_id": node,
        "binding_type": "reference",
        "current_snapshot_id": "00000000-0000-0000-0000-000000000006",
        "node_job_config": '{"task":"native value remains unchanged"}',
        "created_at": "2026-11-12 00:00:00",
        "updated_at": "2026-11-12 00:00:00",
    }


def insert_values(connection: sa.Connection, values: dict[str, str]) -> None:
    connection.execute(
        sa.text(
            "INSERT INTO workflow_agent_node_bindings "
            f"({', '.join(values)}) VALUES ({', '.join(':' + name for name in values)})"
        ),
        values,
    )


def assert_repair_preserves_rows_and_old_writer(connection: sa.Connection, *, reapply: bool) -> None:
    """Exercise actual ALTER/copy SQL; no application constructor supplies defaults."""
    values = {
        **native_values(suffix="000000000001", node="existing-native"),
        "external_job_config": '{"preserved":"external job value"}',
        "binding_epoch": "existing-epoch",
        "original_reference": '{"agent_id":"existing-reference"}',
    }
    insert_values(connection, values)
    snapshot = connection.exec_driver_sql("SELECT * FROM workflow_agent_node_bindings").mappings().one()
    with pytest.raises(IntegrityError), connection.begin_nested():
        insert_values(connection, native_values(suffix="000000000007", node="old-writer-before-repair"))
    context = MigrationContext.configure(connection, opts={"render_as_batch": True})
    with Operations.context(context):
        repair_migration().upgrade()
        if reapply:
            repair_migration().upgrade()
    assert connection.exec_driver_sql("SELECT * FROM workflow_agent_node_bindings").mappings().one() == snapshot
    columns = {column["name"]: column for column in sa.inspect(connection).get_columns("workflow_agent_node_bindings")}
    assert not columns["external_job_config"]["nullable"]
    assert columns["external_job_config"]["default"] is not None
    insert_values(connection, native_values(suffix="000000000008", node="old-writer-after-repair"))
    default = connection.execute(
        sa.text("SELECT external_job_config FROM workflow_agent_node_bindings WHERE node_id=:node"),
        {"node": "old-writer-after-repair"},
    ).scalar_one()
    assert (json.loads(default) if isinstance(default, str) else default) == {}
    preserved = (
        connection.execute(
            sa.text("SELECT * FROM workflow_agent_node_bindings WHERE node_id=:node"), {"node": "existing-native"}
        )
        .mappings()
        .one()
    )
    assert preserved == snapshot


@pytest.mark.parametrize("reapply", [False, True])
def test_sqlite_repairs_applied_c3025_without_replacing_existing_data(reapply: bool) -> None:
    engine = sa.create_engine("sqlite://")
    table = historical_binding_table()
    table.metadata.create_all(engine)
    with engine.begin() as connection:
        assert_repair_preserves_rows_and_old_writer(connection, reapply=reapply)
        with Operations.context(MigrationContext.configure(connection, opts={"render_as_batch": True})):
            repair_migration().downgrade()
        insert_values(connection, native_values(suffix="000000000009", node="old-writer-at-parent"))
    engine.dispose()


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect(), sqlite.dialect()])
def test_model_default_is_the_same_portable_json_expression(dialect: Dialect) -> None:
    current = WorkflowAgentNodeBinding.__table__
    assert isinstance(current, sa.Table)
    column = current.c.external_job_config
    assert column.server_default is not None
    assert "DEFAULT ('{}')" in str(sa.schema.CreateColumn(column).compile(dialect=dialect))
    assert WorkflowAgentNodeBinding.__dataclass_fields__["external_job_config"].default_factory is dict


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect()])
def test_repair_emits_expression_default_without_mysql_alter_default_loss(dialect: Dialect) -> None:
    output = io.StringIO()
    context = MigrationContext.configure(dialect=dialect, opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        repair_migration().upgrade()
    statement = output.getvalue()
    assert "('{}')" in statement
    if dialect.name == "mysql":
        assert "MODIFY" in statement
        assert "JSON NOT NULL DEFAULT ('{}')" in statement
