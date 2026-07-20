from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_06_18_2300-b2515f9d4c2a_agent_drive_skill_metadata_refactor.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("agent_drive_skill_metadata_refactor", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_upgrade_schema(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "agent_drive_files",
        metadata,
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("agent_id", sa.String(36), nullable=False),
        sa.Column("key", sa.String(512), nullable=False),
        sa.Column("file_kind", sa.String(32), nullable=False),
        sa.Column("file_id", sa.String(36), nullable=False),
        sa.Column("value_owned_by_drive", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("hash", sa.String(255), nullable=True),
        sa.Column("mime_type", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "agent_id", "key", name="agent_drive_file_scope_key_unique"),
    )
    sa.Table(
        "agent_config_snapshots",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("config_snapshot", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)


def _run_migration_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def test_upgrade_adds_skill_columns_and_index_and_preserves_snapshot_data() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_upgrade_schema(engine)
    snapshot = {
        "prompt": {"system_prompt": "Use [§skill:legacy:Legacy§]"},
        "skills_files": {"skills": [{"name": "Legacy"}], "files": [{"name": "u.pdf"}]},
    }
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO agent_config_snapshots (id, config_snapshot) VALUES (:id, :config_snapshot)"),
            {"id": "snap-1", "config_snapshot": json.dumps(snapshot)},
        )

    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("agent_drive_files")}
    assert {"is_skill", "skill_metadata"}.issubset(columns)
    indexes = {index["name"] for index in inspector.get_indexes("agent_drive_files")}
    assert "agent_drive_files_tenant_agent_is_skill_key_idx" in indexes

    with engine.begin() as connection:
        stored_snapshot = connection.execute(
            sa.text("SELECT config_snapshot FROM agent_config_snapshots WHERE id = :id"),
            {"id": "snap-1"},
        ).scalar_one()
    assert json.loads(stored_snapshot) == snapshot


def test_downgrade_drops_skill_columns_and_index_without_reconstructing_legacy_data() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_upgrade_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO agent_config_snapshots (id, config_snapshot) VALUES (:id, :config_snapshot)"),
            {"id": "snap-1", "config_snapshot": json.dumps({"prompt": {"system_prompt": "hello"}})},
        )

    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")
    _run_migration_step(module, engine, "downgrade")

    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("agent_drive_files")}
    assert "is_skill" not in columns
    assert "skill_metadata" not in columns
    indexes = {index["name"] for index in inspector.get_indexes("agent_drive_files")}
    assert "agent_drive_files_tenant_agent_is_skill_key_idx" not in indexes

    with engine.begin() as connection:
        stored_snapshot = connection.execute(
            sa.text("SELECT config_snapshot FROM agent_config_snapshots WHERE id = :id"),
            {"id": "snap-1"},
        ).scalar_one()
    assert "skills_files" not in json.loads(stored_snapshot)
