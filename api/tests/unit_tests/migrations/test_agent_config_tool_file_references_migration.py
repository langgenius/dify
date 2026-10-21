from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Literal, Protocol, cast
from uuid import uuid4

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_21_1000-f9b3c7dae462_add_agent_config_tool_file_references.py"
)


class _MigrationModule(Protocol):
    op: object

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


def _load_migration() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location("agent_config_tool_file_references", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load Agent config ToolFile migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _run_step(module: _MigrationModule, engine: sa.Engine, step: Literal["upgrade", "downgrade"]) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            module.upgrade() if step == "upgrade" else module.downgrade()
        finally:
            module.op = original_op


def _soul(
    file_id: str,
    *,
    file_kind: str = "tool_file",
    is_missing: bool = False,
    as_skill: bool = False,
) -> str:
    field_name = "config_skills" if as_skill else "config_files"
    return json.dumps(
        {
            field_name: [
                {
                    "name": "guide.txt",
                    "file_kind": file_kind,
                    "file_id": file_id,
                    "is_missing": is_missing,
                }
            ]
        }
    )


def test_upgrade_adds_reference_schema_without_activating_legacy_rows() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    metadata = sa.MetaData()
    tool_files = sa.Table(
        "tool_files",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
    )
    agents = sa.Table(
        "agents",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
    )
    drafts = sa.Table(
        "agent_config_drafts",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("agent_id", sa.String(36), nullable=False),
        sa.Column("config_snapshot", sa.Text(), nullable=False),
    )
    snapshots = sa.Table(
        "agent_config_snapshots",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("agent_id", sa.String(36), nullable=False),
        sa.Column("config_snapshot", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    tenant_id = str(uuid4())
    other_tenant_id = str(uuid4())
    shared_file_id = str(uuid4())
    snapshot_file_id = str(uuid4())
    foreign_file_id = str(uuid4())
    agent_id = str(uuid4())
    missing_agent_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(agents.insert(), [{"id": agent_id, "tenant_id": tenant_id}])
        connection.execute(
            tool_files.insert(),
            [
                {"id": shared_file_id, "tenant_id": tenant_id},
                {"id": snapshot_file_id, "tenant_id": tenant_id},
                {"id": foreign_file_id, "tenant_id": other_tenant_id},
            ],
        )
        connection.execute(
            drafts.insert(),
            [
                *(
                    {
                        "id": str(uuid4()),
                        "tenant_id": tenant_id,
                        "agent_id": agent_id,
                        "config_snapshot": _soul(shared_file_id),
                    }
                    for _ in range(501)
                ),
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "agent_id": agent_id,
                    "config_snapshot": _soul(foreign_file_id),
                },
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "agent_id": agent_id,
                    "config_snapshot": _soul(shared_file_id, file_kind="upload_file"),
                },
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "agent_id": agent_id,
                    "config_snapshot": _soul(shared_file_id, is_missing=True),
                },
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "agent_id": missing_agent_id,
                    "config_snapshot": _soul(shared_file_id),
                },
            ],
        )
        connection.execute(
            snapshots.insert(),
            [
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "agent_id": agent_id,
                    "config_snapshot": _soul(snapshot_file_id, as_skill=True),
                }
            ],
        )

    module = _load_migration()
    _run_step(module, engine, "upgrade")

    references = sa.Table("agent_config_tool_file_references", sa.MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        rows = connection.execute(
            sa.select(references.c.owner_kind, references.c.tool_file_id).order_by(
                references.c.owner_kind, references.c.owner_id
            )
        ).all()
    assert rows == []
    assert any(column["name"] == "cleanup_started_at" for column in sa.inspect(engine).get_columns("tool_files"))

    with engine.begin() as connection:
        connection.execute(tool_files.delete())
        assert connection.scalar(sa.select(sa.func.count()).select_from(tool_files)) == 0

    _run_step(module, engine, "downgrade")
    assert "agent_config_tool_file_references" not in sa.inspect(engine).get_table_names()
    assert all(column["name"] != "cleanup_started_at" for column in sa.inspect(engine).get_columns("tool_files"))
