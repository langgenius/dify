from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from typing import Protocol, cast

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_VERSIONS_DIR = Path(__file__).resolve().parents[3] / "migrations/versions"
_MIGRATION_PATHS = (
    _VERSIONS_DIR / "2026_07_21_2251-2f39536b3feb_add_agent_home_snapshot_ledger.py",
    _VERSIONS_DIR / "2026_07_23_0203-f6e4c5686857_replace_agent_runtime_sessions_with_.py",
    _VERSIONS_DIR / "2026_07_28_2331-e4708db55c1d_make_home_snapshot_references_nullable.py",
)


class _MigrationModule(Protocol):
    op: Operations
    upgrade: Callable[[], None]


def _load_migration(path: Path) -> _MigrationModule:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load migration {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _run_upgrade(module: _MigrationModule, engine: sa.Engine) -> None:
    with engine.begin() as connection:
        original_op = module.op
        module.op = Operations(MigrationContext.configure(connection))
        try:
            module.upgrade()
        finally:
            module.op = original_op


def _create_pre_home_snapshot_schema(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    drafts = sa.Table("agent_config_drafts", metadata, sa.Column("id", sa.String(36), primary_key=True))
    snapshots = sa.Table("agent_config_snapshots", metadata, sa.Column("id", sa.String(36), primary_key=True))
    conversations = sa.Table("conversations", metadata, sa.Column("id", sa.String(36), primary_key=True))
    executions = sa.Table("workflow_node_executions", metadata, sa.Column("id", sa.String(36), primary_key=True))
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
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(drafts.insert().values(id="draft-1"))
        connection.execute(snapshots.insert().values(id="snapshot-1"))
        connection.execute(conversations.insert().values(id="conversation-1"))
        connection.execute(executions.insert().values(id="execution-1"))
        connection.execute(
            runtime_sessions.insert().values(
                id="runtime-1",
                tenant_id="tenant-1",
                conversation_id="conversation-1",
                agent_id="agent-1",
                agent_config_snapshot_id="snapshot-1",
                status="active",
            )
        )


def _create_old_f6_schema(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    drafts = sa.Table(
        "agent_config_drafts",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("home_snapshot_id", sa.String(36), nullable=False),
    )
    snapshots = sa.Table(
        "agent_config_snapshots",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("home_snapshot_id", sa.String(36), nullable=False),
    )
    bindings = sa.Table(
        "agent_workspace_bindings",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("base_home_snapshot_id", sa.String(36), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(drafts.insert().values(id="draft-1", home_snapshot_id="home-draft"))
        connection.execute(snapshots.insert().values(id="snapshot-1", home_snapshot_id="home-snapshot"))
        connection.execute(bindings.insert().values(id="binding-1", base_home_snapshot_id="home-binding"))


def test_historical_rows_upgrade_through_nullable_home_snapshot_chain() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_pre_home_snapshot_schema(engine)

    for path in _MIGRATION_PATHS:
        _run_upgrade(_load_migration(path), engine)

    inspector = sa.inspect(engine)
    for table_name, column_name in (
        ("agent_config_drafts", "home_snapshot_id"),
        ("agent_config_snapshots", "home_snapshot_id"),
        ("agent_workspace_bindings", "base_home_snapshot_id"),
    ):
        columns = {column["name"]: column for column in inspector.get_columns(table_name)}
        assert columns[column_name]["nullable"] is True

    with engine.connect() as connection:
        assert connection.scalar(sa.text("SELECT home_snapshot_id FROM agent_config_drafts")) is None
        assert connection.scalar(sa.text("SELECT home_snapshot_id FROM agent_config_snapshots")) is None


def test_old_f6_schema_converges_to_nullable_without_changing_data() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_old_f6_schema(engine)

    _run_upgrade(_load_migration(_MIGRATION_PATHS[-1]), engine)

    inspector = sa.inspect(engine)
    for table_name, column_name in (
        ("agent_config_drafts", "home_snapshot_id"),
        ("agent_config_snapshots", "home_snapshot_id"),
        ("agent_workspace_bindings", "base_home_snapshot_id"),
    ):
        columns = {column["name"]: column for column in inspector.get_columns(table_name)}
        assert columns[column_name]["nullable"] is True

    with engine.connect() as connection:
        assert connection.scalar(sa.text("SELECT home_snapshot_id FROM agent_config_drafts")) == "home-draft"
        assert connection.scalar(sa.text("SELECT home_snapshot_id FROM agent_config_snapshots")) == "home-snapshot"
        assert (
            connection.scalar(sa.text("SELECT base_home_snapshot_id FROM agent_workspace_bindings")) == "home-binding"
        )
