from __future__ import annotations

import importlib.util
import json
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3] / "migrations/versions/2026_08_17_1740-89919253ca7a_remove_agent_drive.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("remove_agent_drive", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_upgrade_schema(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    sa.Table("agent_drive_files", metadata, sa.Column("id", sa.String(36), primary_key=True))
    for table_name in ("agent_config_snapshots", "agent_config_drafts"):
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("config_snapshot", sa.Text(), nullable=False),
        )
    sa.Table(
        "workflow_agent_node_bindings",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("node_job_config", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)


def _run_migration_step(module: ModuleType, engine: sa.Engine, step_name: str) -> None:
    migration_step = module.__dict__[step_name]
    if not callable(migration_step):
        raise TypeError(f"migration step {step_name!r} is not callable")

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            migration_step()
        finally:
            module.__dict__["op"] = original_op


def test_upgrade_removes_agent_drive_schema_and_legacy_json_fields() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_upgrade_schema(engine)
    soul = {
        "files": {"skills": [{"name": "legacy"}]},
        "config_skills": [{"name": "current", "file_id": "tool-1"}],
        "prompt": {"system_prompt": "hello"},
    }
    node_job = {
        "metadata": {
            "file_refs": [
                {"id": "upload-1", "drive_key": "files/input.pdf"},
                {"id": "upload-2"},
            ]
        },
        "declared_outputs": [
            {
                "name": "report",
                "type": "file",
                "check": {"benchmark_file_ref": {"id": "upload-3", "drive_key": "files/reference.pdf"}},
            }
        ],
    }
    with engine.begin() as connection:
        for table_name in ("agent_config_snapshots", "agent_config_drafts"):
            connection.execute(
                sa.text(f"INSERT INTO {table_name} (id, config_snapshot) VALUES (:id, :value)"),
                {"id": table_name, "value": json.dumps(soul)},
            )
        connection.execute(
            sa.text("INSERT INTO workflow_agent_node_bindings (id, node_job_config) VALUES (:id, :value)"),
            {"id": "binding-1", "value": json.dumps(node_job)},
        )

    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    assert "agent_drive_files" not in sa.inspect(engine).get_table_names()
    with engine.begin() as connection:
        for table_name in ("agent_config_snapshots", "agent_config_drafts"):
            stored = connection.execute(sa.text(f"SELECT config_snapshot FROM {table_name}")).scalar_one()
            value = json.loads(stored)
            assert "files" not in value
            assert value["config_skills"] == soul["config_skills"]
            assert value["prompt"] == soul["prompt"]
        stored_node_job = connection.execute(
            sa.text("SELECT node_job_config FROM workflow_agent_node_bindings")
        ).scalar_one()

    migrated_node_job = json.loads(stored_node_job)
    assert migrated_node_job["metadata"]["file_refs"] == [{"id": "upload-1"}, {"id": "upload-2"}]
    assert migrated_node_job["declared_outputs"][0]["check"]["benchmark_file_ref"] == {"id": "upload-3"}

    _run_migration_step(module, engine, "downgrade")
    inspector = sa.inspect(engine)
    assert "agent_drive_files" in inspector.get_table_names()
    assert {
        "tenant_id",
        "agent_id",
        "key",
        "file_kind",
        "file_id",
        "value_owned_by_drive",
        "is_skill",
        "skill_metadata",
    }.issubset({column["name"] for column in inspector.get_columns("agent_drive_files")})
    assert "agent_drive_file_scope_key_unique" in {
        constraint["name"] for constraint in inspector.get_unique_constraints("agent_drive_files")
    }
    assert "agent_drive_files_tenant_agent_is_skill_key_idx" in {
        index["name"] for index in inspector.get_indexes("agent_drive_files")
    }


def test_upgrade_supports_offline_sql_generation() -> None:
    module = _load_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    operations = Operations(migration_context)
    migration_step = module.__dict__["upgrade"]
    if not callable(migration_step):
        raise TypeError("migration upgrade is not callable")

    original_op = module.__dict__["op"]
    module.__dict__["op"] = operations
    try:
        migration_step()
    finally:
        module.__dict__["op"] = original_op

    generated_sql = output.getvalue()
    assert "DROP TABLE agent_drive_files" in generated_sql
    assert "SELECT id" not in generated_sql


@pytest.mark.parametrize(
    ("table_name", "column_name"),
    [
        pytest.param("agent_config_snapshots", "config_snapshot", id="config-snapshot"),
        pytest.param("workflow_agent_node_bindings", "node_job_config", id="node-job-config"),
    ],
)
def test_upgrade_rejects_invalid_json_without_rewriting(table_name: str, column_name: str) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_upgrade_schema(engine)
    invalid_json = "not-json"
    with engine.begin() as connection:
        connection.execute(
            sa.text(f"INSERT INTO {table_name} (id, {column_name}) VALUES (:id, :value)"),
            {"id": "invalid-row", "value": invalid_json},
        )

    module = _load_migration_module()
    with pytest.raises(json.JSONDecodeError):
        _run_migration_step(module, engine, "upgrade")

    with engine.begin() as connection:
        stored = connection.execute(sa.text(f"SELECT {column_name} FROM {table_name}")).scalar_one()
    assert stored == invalid_json
    assert "agent_drive_files" in sa.inspect(engine).get_table_names()
