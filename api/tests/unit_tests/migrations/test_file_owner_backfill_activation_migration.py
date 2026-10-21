from __future__ import annotations

import importlib
import importlib.util
import io
import json
from pathlib import Path
from typing import Literal, Protocol, cast

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_21_1400-d3f7a9c1e584_activate_file_owner_backfills.py"
)
_HISTORICAL_MODULE_NAMES = (
    "migrations.versions.2026_10_19_1400-f3b9c1e4a826_add_knowledge_file_lifecycle",
    "migrations.versions.2026_10_20_1800-d7f1a5b8c240_add_agent_config_upload_file_references",
    "migrations.versions.2026_10_21_1000-f9b3c7dae462_add_agent_config_tool_file_references",
)


class _MigrationModule(Protocol):
    op: object

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


class _HistoricalMigrationModule(Protocol):
    op: object


def _load_migration() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location("file_owner_backfill_activation", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load file-owner backfill activation migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _run_step(module: _MigrationModule, engine: sa.Engine, step: Literal["upgrade", "downgrade"]) -> None:
    historical_modules = tuple(
        cast(_HistoricalMigrationModule, importlib.import_module(module_name))
        for module_name in _HISTORICAL_MODULE_NAMES
    )
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        modules = (module, *historical_modules)
        original_operations = tuple(migration_module.op for migration_module in modules)
        for migration_module in modules:
            migration_module.op = operations
        try:
            module.upgrade() if step == "upgrade" else module.downgrade()
        finally:
            for migration_module, original_op in zip(modules, original_operations, strict=True):
                migration_module.op = original_op


def _render_step(module: _MigrationModule, step: Literal["upgrade", "downgrade"]) -> str:
    output = io.StringIO()
    operations = Operations(
        MigrationContext.configure(
            dialect_name="sqlite",
            opts={"as_sql": True, "output_buffer": output},
        )
    )
    original_op = module.op
    module.op = operations
    try:
        module.upgrade() if step == "upgrade" else module.downgrade()
    finally:
        module.op = original_op
    return output.getvalue()


def _define_schema(engine: sa.Engine) -> dict[str, sa.Table]:
    metadata = sa.MetaData()
    tables = {
        "upload_files": sa.Table(
            "upload_files",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
        ),
        "documents": sa.Table(
            "documents",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("dataset_id", sa.String(36), nullable=False),
            sa.Column("data_source_type", sa.String(255), nullable=False),
            sa.Column("data_source_info", sa.Text()),
        ),
        "document_segments": sa.Table(
            "document_segments",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("dataset_id", sa.String(36), nullable=False),
            sa.Column("document_id", sa.String(36), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
        ),
        "workflows": sa.Table(
            "workflows",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("app_id", sa.String(36), nullable=False),
        ),
        "workflow_draft_variables": sa.Table(
            "workflow_draft_variables",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("app_id", sa.String(36), nullable=False),
            sa.Column("node_id", sa.String(255), nullable=False),
            sa.Column("value_type", sa.String(20), nullable=False),
            sa.Column("value", sa.Text(), nullable=False),
        ),
        "knowledge_upload_file_references": sa.Table(
            "knowledge_upload_file_references",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("upload_file_id", sa.String(36), nullable=False),
            sa.Column("dataset_id", sa.String(36), nullable=False),
            sa.Column("document_id", sa.String(36), nullable=False),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("resource_id", sa.String(36), nullable=False),
            sa.UniqueConstraint("tenant_id", "kind", "resource_id", "upload_file_id"),
        ),
        "workflow_draft_variable_upload_file_references": sa.Table(
            "workflow_draft_variable_upload_file_references",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("app_id", sa.String(36), nullable=False),
            sa.Column("draft_variable_id", sa.String(36), nullable=False),
            sa.Column("node_id", sa.String(255), nullable=False),
            sa.Column("upload_file_id", sa.String(36), nullable=False),
            sa.UniqueConstraint("tenant_id", "draft_variable_id", "upload_file_id"),
        ),
        "agents": sa.Table(
            "agents",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
        ),
        "agent_config_drafts": sa.Table(
            "agent_config_drafts",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=False),
            sa.Column("config_snapshot", sa.Text(), nullable=False),
        ),
        "agent_config_snapshots": sa.Table(
            "agent_config_snapshots",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=False),
            sa.Column("config_snapshot", sa.Text(), nullable=False),
        ),
        "agent_config_upload_file_references": sa.Table(
            "agent_config_upload_file_references",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("owner_kind", sa.String(16), nullable=False),
            sa.Column("owner_id", sa.String(36), nullable=False),
            sa.Column("upload_file_id", sa.String(36), nullable=False),
            sa.UniqueConstraint("tenant_id", "owner_kind", "owner_id", "upload_file_id"),
        ),
        "tool_files": sa.Table(
            "tool_files",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
        ),
        "agent_config_tool_file_references": sa.Table(
            "agent_config_tool_file_references",
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("owner_kind", sa.String(16), nullable=False),
            sa.Column("owner_id", sa.String(36), nullable=False),
            sa.Column("tool_file_id", sa.String(36), nullable=False),
            sa.UniqueConstraint("tenant_id", "owner_kind", "owner_id", "tool_file_id"),
        ),
    }
    metadata.create_all(engine)
    return tables


def _config_snapshot() -> str:
    return json.dumps(
        {
            "config_files": [
                {
                    "name": "knowledge.txt",
                    "file_kind": "upload_file",
                    "file_id": "agent-upload",
                },
                {
                    "name": "tool.txt",
                    "file_kind": "tool_file",
                    "file_id": "config-tool",
                },
            ],
            "config_skills": [{"name": "skill.zip", "file_id": "skill-tool"}],
        }
    )


def _seed_owners(engine: sa.Engine, tables: dict[str, sa.Table]) -> None:
    with engine.begin() as connection:
        connection.execute(
            tables["upload_files"].insert(),
            [
                {"id": "document-source", "tenant_id": "tenant-1"},
                {"id": "segment-image", "tenant_id": "tenant-1"},
                {"id": "agent-upload", "tenant_id": "tenant-1"},
            ],
        )
        connection.execute(
            tables["tool_files"].insert(),
            [
                {"id": "config-tool", "tenant_id": "tenant-1"},
                {"id": "skill-tool", "tenant_id": "tenant-1"},
            ],
        )
        connection.execute(tables["agents"].insert(), [{"id": "agent-1", "tenant_id": "tenant-1"}])
        connection.execute(
            tables["documents"].insert(),
            [
                {
                    "id": "document-1",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "data_source_type": "upload_file",
                    "data_source_info": json.dumps({"upload_file_id": "document-source"}),
                }
            ],
        )
        connection.execute(
            tables["document_segments"].insert(),
            [
                {
                    "id": "segment-1",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "document_id": "document-1",
                    "content": "![diagram](/files/segment-image/image-preview)",
                }
            ],
        )
        for table_name, owner_id in (
            ("agent_config_drafts", "draft-1"),
            ("agent_config_snapshots", "snapshot-1"),
        ):
            connection.execute(
                tables[table_name].insert(),
                [
                    {
                        "id": owner_id,
                        "tenant_id": "tenant-1",
                        "agent_id": "agent-1",
                        "config_snapshot": _config_snapshot(),
                    }
                ],
            )


def _logical_reference_rows(engine: sa.Engine, tables: dict[str, sa.Table]) -> dict[str, list[tuple[object, ...]]]:
    columns_by_table = {
        "knowledge_upload_file_references": ("kind", "resource_id", "upload_file_id"),
        "workflow_draft_variable_upload_file_references": (
            "app_id",
            "draft_variable_id",
            "upload_file_id",
        ),
        "agent_config_upload_file_references": ("owner_kind", "owner_id", "upload_file_id"),
        "agent_config_tool_file_references": ("owner_kind", "owner_id", "tool_file_id"),
    }
    with engine.connect() as connection:
        return {
            table_name: [
                tuple(row)
                for row in connection.execute(
                    sa.select(*(tables[table_name].c[column] for column in column_names)).order_by(
                        *(tables[table_name].c[column] for column in column_names)
                    )
                ).all()
            ]
            for table_name, column_names in columns_by_table.items()
        }


def test_upgrade_activates_all_file_owner_backfills_and_is_idempotent() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _define_schema(engine)
    _seed_owners(engine, tables)
    module = _load_migration()

    _run_step(module, engine, "upgrade")
    first_rows = _logical_reference_rows(engine, tables)
    assert first_rows == {
        "knowledge_upload_file_references": [
            ("document_source", "document-1", "document-source"),
            ("segment_image", "segment-1", "segment-image"),
        ],
        "workflow_draft_variable_upload_file_references": [],
        "agent_config_upload_file_references": [
            ("draft", "draft-1", "agent-upload"),
            ("snapshot", "snapshot-1", "agent-upload"),
        ],
        "agent_config_tool_file_references": [
            ("draft", "draft-1", "config-tool"),
            ("draft", "draft-1", "skill-tool"),
            ("snapshot", "snapshot-1", "config-tool"),
            ("snapshot", "snapshot-1", "skill-tool"),
        ],
    }

    _run_step(module, engine, "upgrade")
    assert _logical_reference_rows(engine, tables) == first_rows

    _run_step(module, engine, "downgrade")
    assert _logical_reference_rows(engine, tables) == {table_name: [] for table_name in first_rows}


def test_offline_render_requires_online_data_activation() -> None:
    module = _load_migration()

    assert "activation requires an online upgrade" in _render_step(module, "upgrade")
    assert "deactivation requires an online downgrade" in _render_step(module, "downgrade")
