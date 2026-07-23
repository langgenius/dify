from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_23_0203-f6e4c5686857_replace_agent_runtime_sessions_with_.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("agent_workspace_migration", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load Agent Workspace migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_upgrade_schema(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    runtime_sessions = sa.Table(
        "agent_runtime_sessions",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36)),
        sa.Column("workflow_run_id", sa.String(36)),
        sa.Column("node_id", sa.String(255)),
        sa.Column("binding_id", sa.String(36)),
        sa.Column("agent_id", sa.String(36), nullable=False),
        sa.Column("agent_config_snapshot_id", sa.String(36)),
        sa.Column("home_snapshot_id", sa.String(36), nullable=False),
        sa.Column("backend_run_id", sa.String(255)),
        sa.Column("status", sa.String(32), nullable=False),
    )
    sa.Index("agent_runtime_session_backend_run_idx", runtime_sessions.c.backend_run_id)
    sa.Index(
        "agent_runtime_session_conversation_lookup_idx",
        runtime_sessions.c.tenant_id,
        runtime_sessions.c.conversation_id,
        runtime_sessions.c.status,
    )
    sa.Index(
        "agent_runtime_session_conversation_scope_unique",
        runtime_sessions.c.tenant_id,
        runtime_sessions.c.conversation_id,
        runtime_sessions.c.agent_id,
        runtime_sessions.c.agent_config_snapshot_id,
        runtime_sessions.c.home_snapshot_id,
        unique=True,
    )
    sa.Index(
        "agent_runtime_session_workflow_lookup_idx",
        runtime_sessions.c.tenant_id,
        runtime_sessions.c.workflow_run_id,
        runtime_sessions.c.node_id,
        runtime_sessions.c.status,
    )
    sa.Index(
        "agent_runtime_session_workflow_scope_unique",
        runtime_sessions.c.tenant_id,
        runtime_sessions.c.workflow_run_id,
        runtime_sessions.c.node_id,
        runtime_sessions.c.binding_id,
        runtime_sessions.c.agent_id,
        unique=True,
    )
    sa.Table(
        "agent_home_snapshots",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("agent_id", sa.String(36), nullable=False),
        sa.Column("snapshot_ref", sa.String(255), nullable=False),
    )
    for table_name in ("conversations", "agent_config_drafts", "workflow_node_executions"):
        sa.Table(table_name, metadata, sa.Column("id", sa.String(36), primary_key=True))
    metadata.create_all(engine)


def _run_upgrade(module: object, engine: sa.Engine) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            module.upgrade()
        finally:
            module.op = original_op


def test_upgrade_replaces_runtime_sessions_with_workspace_schema() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_upgrade_schema(engine)

    _run_upgrade(_load_migration_module(), engine)

    inspector = sa.inspect(engine)
    assert "agent_runtime_sessions" not in inspector.get_table_names()
    binding_columns = {column["name"] for column in inspector.get_columns("agent_workspace_bindings")}
    assert {
        "workspace_id",
        "agent_id",
        "base_home_snapshot_id",
        "agent_config_version_id",
        "agent_config_version_kind",
        "backend_binding_ref",
        "session_snapshot",
        "status",
        "retired_at",
        "pending_form_id",
        "pending_tool_call_id",
    }.issubset(binding_columns)
    assert "active_guard" not in binding_columns
    binding_indexes = {index["name"] for index in inspector.get_indexes("agent_workspace_bindings")}
    assert "agent_workspace_binding_agent_active_unique" not in binding_indexes
    workspace_columns = {column["name"] for column in inspector.get_columns("agent_workspaces")}
    assert {"owner_type", "owner_id", "owner_scope_key", "backend_workspace_ref", "status"}.issubset(
        workspace_columns
    )
    workspace_indexes = {index["name"] for index in inspector.get_indexes("agent_workspaces")}
    assert "agent_workspace_owner_active_unique" in workspace_indexes
    home_columns = {column["name"] for column in inspector.get_columns("agent_home_snapshots")}
    assert {"status", "retired_at"}.issubset(home_columns)
    home_indexes = {index["name"] for index in inspector.get_indexes("agent_home_snapshots")}
    assert "agent_home_snapshot_status_retired_idx" in home_indexes
    for table_name in ("conversations", "agent_config_drafts", "workflow_node_executions"):
        caller_columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert "agent_workspace_binding_id" in caller_columns
