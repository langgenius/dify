from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Literal, Protocol, cast

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from core.workflow.file_reference import build_file_reference

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_19_1400-f3b9c1e4a826_add_knowledge_file_lifecycle.py"
)


class _MigrationModule(Protocol):
    op: object

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


def _load_migration() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location("knowledge_file_lifecycle", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load knowledge file lifecycle migration")
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


def test_upgrade_backfills_upload_local_and_segment_image_references() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    uploads = sa.Table(
        "upload_files",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
    )
    documents = sa.Table(
        "documents",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("dataset_id", sa.String(36), nullable=False),
        sa.Column("data_source_type", sa.String(255), nullable=False),
        sa.Column("data_source_info", sa.Text()),
    )
    segments = sa.Table(
        "document_segments",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("dataset_id", sa.String(36), nullable=False),
        sa.Column("document_id", sa.String(36), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
    )
    workflows = sa.Table(
        "workflows",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("app_id", sa.String(36), nullable=False),
    )
    draft_variables = sa.Table(
        "workflow_draft_variables",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("app_id", sa.String(36), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
        sa.Column("value_type", sa.String(20), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            uploads.insert(),
            [
                {"id": "file-upload", "tenant_id": "tenant-1"},
                {"id": "file-local", "tenant_id": "tenant-1"},
                {"id": "file-image", "tenant_id": "tenant-1"},
                {"id": "foreign-file", "tenant_id": "tenant-2"},
                {"id": "workflow-file", "tenant_id": "tenant-1"},
                {"id": "workflow-array-file", "tenant_id": "tenant-1"},
            ],
        )
        connection.execute(
            workflows.insert(),
            [{"id": "workflow-1", "tenant_id": "tenant-1", "app_id": "workflow-app-1"}],
        )
        connection.execute(
            draft_variables.insert(),
            [
                {
                    "id": "draft-file",
                    "app_id": "workflow-app-1",
                    "node_id": "node-1",
                    "value_type": "file",
                    "value": json.dumps(
                        {
                            "transfer_method": "local_file",
                            "reference": build_file_reference(record_id="workflow-file"),
                        }
                    ),
                },
                {
                    "id": "draft-array",
                    "app_id": "workflow-app-1",
                    "node_id": "node-2",
                    "value_type": "array[file]",
                    "value": json.dumps(
                        [
                            {
                                "transfer_method": "remote_url",
                                "related_id": "workflow-array-file",
                            },
                            {"transfer_method": "remote_url", "url": "https://example.test/external.png"},
                            {"transfer_method": "tool_file", "related_id": "tool-file"},
                            {"transfer_method": "local_file", "related_id": "foreign-file"},
                        ]
                    ),
                },
                *(
                    {
                        "id": f"bulk-draft-{index:04}",
                        "app_id": "workflow-app-1",
                        "node_id": "bulk-node",
                        "value_type": "file",
                        "value": json.dumps(
                            {
                                "transfer_method": "local_file",
                                "related_id": "workflow-file",
                            }
                        ),
                    }
                    for index in range(501)
                ),
            ],
        )
        connection.execute(
            documents.insert(),
            [
                {
                    "id": "document-upload",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "data_source_type": "upload_file",
                    "data_source_info": json.dumps({"upload_file_id": "file-upload"}),
                },
                {
                    "id": "document-local",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "data_source_type": "local_file",
                    "data_source_info": json.dumps({"reference": build_file_reference(record_id="file-local")}),
                },
                {
                    "id": "document-foreign",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "data_source_type": "local_file",
                    "data_source_info": json.dumps({"related_id": "foreign-file"}),
                },
                *(
                    {
                        "id": f"bulk-document-{index:04}",
                        "tenant_id": "tenant-1",
                        "dataset_id": "dataset-1",
                        "data_source_type": "upload_file",
                        "data_source_info": json.dumps({"upload_file_id": "file-upload"}),
                    }
                    for index in range(1001)
                ),
            ],
        )
        connection.execute(
            segments.insert(),
            [
                {
                    "id": "segment-1",
                    "tenant_id": "tenant-1",
                    "dataset_id": "dataset-1",
                    "document_id": "document-local",
                    "content": "![diagram][stored-image]\n\n[stored-image]: /files/file-image/image-preview",
                },
                *(
                    {
                        "id": f"bulk-segment-{index:04}",
                        "tenant_id": "tenant-1",
                        "dataset_id": "dataset-1",
                        "document_id": "document-local",
                        "content": "![image](https://example.test/files/file-image/image-preview)",
                    }
                    for index in range(501)
                ),
            ],
        )

    module = _load_migration()
    _run_step(module, engine, "upgrade")

    references = sa.Table("knowledge_upload_file_references", sa.MetaData(), autoload_with=engine)
    workflow_references = sa.Table(
        "workflow_draft_variable_upload_file_references",
        sa.MetaData(),
        autoload_with=engine,
    )
    with engine.connect() as connection:
        rows = connection.execute(
            sa.select(references.c.kind, references.c.resource_id, references.c.upload_file_id).order_by(
                references.c.kind,
                references.c.resource_id,
            )
        ).all()
        workflow_rows = connection.execute(
            sa.select(
                workflow_references.c.tenant_id,
                workflow_references.c.app_id,
                workflow_references.c.draft_variable_id,
                workflow_references.c.node_id,
                workflow_references.c.upload_file_id,
            ).order_by(workflow_references.c.draft_variable_id)
        ).all()
    assert sum(row.kind == "document_source" for row in rows) == 1003
    assert sum(row.kind == "segment_image" for row in rows) == 502
    assert ("document_source", "document-local", "file-local") in rows
    assert ("document_source", "bulk-document-1000", "file-upload") in rows
    assert ("segment_image", "bulk-segment-0500", "file-image") in rows
    assert len(workflow_rows) == 503
    assert ("tenant-1", "workflow-app-1", "draft-array", "node-2", "workflow-array-file") in workflow_rows
    assert ("tenant-1", "workflow-app-1", "draft-file", "node-1", "workflow-file") in workflow_rows
    assert ("tenant-1", "workflow-app-1", "bulk-draft-0500", "bulk-node", "workflow-file") in workflow_rows
    inspector = sa.inspect(engine)
    assert "knowledge_cleanup_started_at" in {column["name"] for column in inspector.get_columns("upload_files")}
    assert "indexing_generation" in {column["name"] for column in inspector.get_columns("documents")}
    assert "indexing_generation" in {column["name"] for column in inspector.get_columns("document_segments")}

    _run_step(module, engine, "downgrade")
    assert "knowledge_upload_file_references" not in sa.inspect(engine).get_table_names()
    assert "workflow_draft_variable_upload_file_references" not in sa.inspect(engine).get_table_names()
