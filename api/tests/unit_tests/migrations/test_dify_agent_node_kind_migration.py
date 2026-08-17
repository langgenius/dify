from __future__ import annotations

import importlib.util
import json
from collections.abc import Callable
from io import StringIO
from pathlib import Path
from typing import Protocol, cast

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_17_1200-c4b92d6f1a70_backfill_dify_agent_node_kind.py"
)

_HISTORICAL_WORKFLOW_ID = "11111111-1111-1111-1111-111111111111"
_BOUND_WORKFLOW_ID = "22222222-2222-2222-2222-222222222222"
_MARKED_WORKFLOW_ID = "33333333-3333-3333-3333-333333333333"
_VERSION_ONE_WORKFLOW_ID = "44444444-4444-4444-4444-444444444444"


class _MigrationModule(Protocol):
    op: Operations
    upgrade: Callable[[], None]


def _load_migration_module() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location("dify_agent_node_kind_migration", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load Dify Agent node kind migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _create_schema(engine: sa.Engine) -> tuple[sa.Table, sa.Table]:
    metadata = sa.MetaData()
    workflows = sa.Table(
        "workflows",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("graph", sa.Text(), nullable=False),
    )
    bindings = sa.Table(
        "workflow_agent_node_bindings",
        metadata,
        sa.Column("workflow_id", sa.String(36), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
    )
    metadata.create_all(engine)
    return workflows, bindings


def _graph(*, version: str = "2", marker: str | None = None) -> str:
    node_data = {"type": "agent", "version": version, "title": "Agent"}
    if marker is not None:
        node_data["agent_node_kind"] = marker
    return json.dumps({"nodes": [{"id": "agent-node", "data": node_data}], "edges": []})


def _run_upgrade(module: _MigrationModule, engine: sa.Engine) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            module.upgrade()
        finally:
            module.op = original_op


def test_upgrade_only_marks_bound_dify_agent_nodes() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    workflows, bindings = _create_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            workflows.insert(),
            [
                {"id": _HISTORICAL_WORKFLOW_ID, "graph": _graph()},
                {"id": _BOUND_WORKFLOW_ID, "graph": _graph()},
                {"id": _MARKED_WORKFLOW_ID, "graph": _graph(marker="dify_agent")},
                {"id": _VERSION_ONE_WORKFLOW_ID, "graph": _graph(version="1")},
            ],
        )
        connection.execute(
            bindings.insert(),
            [
                {"workflow_id": _BOUND_WORKFLOW_ID, "node_id": "agent-node"},
                {"workflow_id": _MARKED_WORKFLOW_ID, "node_id": "agent-node"},
                {"workflow_id": _VERSION_ONE_WORKFLOW_ID, "node_id": "agent-node"},
            ],
        )

    _run_upgrade(_load_migration_module(), engine)

    with engine.begin() as connection:
        stored_graphs = {
            workflow_id: json.loads(graph)
            for workflow_id, graph in connection.execute(sa.select(workflows.c.id, workflows.c.graph))
        }

    def node_data(workflow_id: str) -> dict[str, object]:
        return stored_graphs[workflow_id]["nodes"][0]["data"]

    assert "agent_node_kind" not in node_data(_HISTORICAL_WORKFLOW_ID)
    assert node_data(_BOUND_WORKFLOW_ID)["agent_node_kind"] == "dify_agent"
    assert node_data(_MARKED_WORKFLOW_ID)["agent_node_kind"] == "dify_agent"
    assert "agent_node_kind" not in node_data(_VERSION_ONE_WORKFLOW_ID)


def test_upgrade_is_safe_during_offline_sql_generation() -> None:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    module = _load_migration_module()
    original_op = module.op
    module.op = Operations(context)
    try:
        module.upgrade()
    finally:
        module.op = original_op

    assert output.getvalue() == ""
