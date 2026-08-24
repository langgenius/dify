from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.agent_config_entities import (
    WorkflowNodeJobConfig,
    effective_declared_outputs,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_21_1422-925e75620b69_simplify_agent_v2_output_contract.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("simplify_agent_v2_output_contract", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_removes_legacy_preset_outputs_and_preserves_custom_output_configuration() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "workflow_agent_node_bindings",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("node_job_config", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    custom_outputs = [
        {
            "name": "summary",
            "type": "string",
            "required": True,
            "description": "Keep every setting",
            "failure_strategy": {"on_failure": "stop"},
        },
        {
            "name": "attachments",
            "type": "array",
            "required": False,
            "array_item": {"type": "file", "description": "Produced file"},
        },
    ]
    node_job = {
        "workflow_prompt": "Produce a result",
        "declared_outputs": [
            {"name": "text", "type": "string"},
            custom_outputs[0],
            {"name": "files", "type": "array", "array_item": {"type": "file"}},
            custom_outputs[1],
            {"name": "json", "type": "object"},
        ],
    }
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO workflow_agent_node_bindings (id, node_job_config) VALUES (:id, :node_job_config)"),
            {"id": "binding-1", "node_job_config": json.dumps(node_job)},
        )

    module = _load_migration_module()
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            module.upgrade()
        finally:
            module.__dict__["op"] = original_op

    with engine.begin() as connection:
        stored = connection.execute(
            sa.text("SELECT node_job_config FROM workflow_agent_node_bindings WHERE id = :id"),
            {"id": "binding-1"},
        ).scalar_one()

    migrated_node_job = json.loads(stored)
    assert migrated_node_job["workflow_prompt"] == "Produce a result"
    assert migrated_node_job["declared_outputs"] == custom_outputs

    node_job = WorkflowNodeJobConfig.model_validate(migrated_node_job)
    assert [output.name for output in effective_declared_outputs(node_job.declared_outputs)] == [
        "text",
        "summary",
        "attachments",
    ]
