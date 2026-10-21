"""add indexed knowledge file lifecycle

Revision ID: f3b9c1e4a826
Revises: e2a8b0d3f715
Create Date: 2026-10-19 14:00:00.000000

The one-time backfill replaces runtime tenant-wide JSON scans. New writes keep
the reference table synchronized in the same transaction as their owner row.
"""

import base64
import json
from collections.abc import Iterable, Mapping
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

from libs.markdown_images import extract_upload_file_ids_from_markdown
from models.types import StringUUID
from models.utils.file_input_compat import resolve_upload_file_ids_from_serialized_file_value

revision = "f3b9c1e4a826"
down_revision = "e2a8b0d3f715"
branch_labels = None
depends_on = None

_REFERENCE_PREFIX = "dify-file-ref:"


def _resolve_reference(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if not value.startswith(_REFERENCE_PREFIX):
        return value
    try:
        payload = json.loads(base64.urlsafe_b64decode(value.removeprefix(_REFERENCE_PREFIX).encode()))
    except (ValueError, json.JSONDecodeError):
        return value
    record_id = payload.get("record_id") if isinstance(payload, Mapping) else None
    return record_id if isinstance(record_id, str) and record_id else value


def _document_file_ids(data_source_type: object, raw_info: object) -> tuple[str, ...]:
    if not isinstance(raw_info, str) or not raw_info:
        return ()
    try:
        info = json.loads(raw_info)
    except (TypeError, json.JSONDecodeError):
        return ()
    if not isinstance(info, Mapping):
        return ()
    if data_source_type == "upload_file":
        value = info.get("upload_file_id")
        return (value,) if isinstance(value, str) and value else ()
    if data_source_type != "local_file":
        return ()
    values = (
        _resolve_reference(info.get("reference")),
        _resolve_reference(info.get("related_id")),
        info.get("upload_file_id"),
        info.get("real_file_id"),
    )
    return tuple(dict.fromkeys(value for value in values if isinstance(value, str) and value))


def _insert_existing_references(rows: Iterable[dict[str, object]]) -> None:
    connection = op.get_bind()
    references = sa.table(
        "knowledge_upload_file_references",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("upload_file_id", StringUUID()),
        sa.column("dataset_id", StringUUID()),
        sa.column("document_id", StringUUID()),
        sa.column("kind", sa.String(length=32)),
        sa.column("resource_id", StringUUID()),
    )
    upload_files = sa.table(
        "upload_files",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
    )
    unique_rows = {
        (
            row["tenant_id"],
            row["upload_file_id"],
            row["kind"],
            row["resource_id"],
        ): row
        for row in rows
    }
    if not unique_rows:
        return
    candidate_pairs = {(key[0], key[1]) for key in unique_rows}
    tenant_ids = tuple({pair[0] for pair in candidate_pairs})
    file_ids = tuple({pair[1] for pair in candidate_pairs})
    existing_pairs = set(
        connection.execute(
            sa.select(upload_files.c.tenant_id, upload_files.c.id).where(
                upload_files.c.tenant_id.in_(tenant_ids),
                upload_files.c.id.in_(file_ids),
            )
        ).all()
    )
    valid_rows = [row for key, row in unique_rows.items() if (key[0], key[1]) in existing_pairs]
    if valid_rows:
        connection.execute(sa.insert(references), valid_rows)


def _insert_existing_workflow_references(rows: Iterable[dict[str, object]]) -> None:
    connection = op.get_bind()
    references = sa.table(
        "workflow_draft_variable_upload_file_references",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("draft_variable_id", StringUUID()),
        sa.column("node_id", sa.String(length=255)),
        sa.column("upload_file_id", StringUUID()),
    )
    upload_files = sa.table(
        "upload_files",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
    )
    unique_rows = {(row["tenant_id"], row["draft_variable_id"], row["upload_file_id"]): row for row in rows}
    if not unique_rows:
        return
    tenant_ids = tuple({key[0] for key in unique_rows})
    file_ids = tuple({key[2] for key in unique_rows})
    existing_pairs = set(
        connection.execute(
            sa.select(upload_files.c.tenant_id, upload_files.c.id).where(
                upload_files.c.tenant_id.in_(tenant_ids),
                upload_files.c.id.in_(file_ids),
            )
        ).all()
    )
    valid_rows = [row for key, row in unique_rows.items() if (key[0], key[2]) in existing_pairs]
    if valid_rows:
        connection.execute(sa.insert(references), valid_rows)


def _backfill_references() -> None:
    connection = op.get_bind()
    documents = sa.table(
        "documents",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("dataset_id", StringUUID()),
        sa.column("data_source_type", sa.String(length=255)),
        sa.column("data_source_info", sa.Text()),
    )
    segments = sa.table(
        "document_segments",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("dataset_id", StringUUID()),
        sa.column("document_id", StringUUID()),
        sa.column("content", sa.Text()),
    )

    document_cursor: str | None = None
    while True:
        document_query = (
            sa.select(
                documents.c.id,
                documents.c.tenant_id,
                documents.c.dataset_id,
                documents.c.data_source_type,
                documents.c.data_source_info,
            )
            .where(documents.c.data_source_type.in_(("upload_file", "local_file")))
            .order_by(documents.c.id)
            .limit(1000)
        )
        if document_cursor is not None:
            document_query = document_query.where(documents.c.id > document_cursor)
        with connection.execute(document_query) as result:
            rows = result.all()
        if not rows:
            break
        _insert_existing_references(
            {
                "id": str(uuid4()),
                "tenant_id": row.tenant_id,
                "upload_file_id": file_id,
                "dataset_id": row.dataset_id,
                "document_id": row.id,
                "kind": "document_source",
                "resource_id": row.id,
            }
            for row in rows
            for file_id in _document_file_ids(row.data_source_type, row.data_source_info)
        )
        document_cursor = rows[-1].id

    segment_cursor: str | None = None
    while True:
        segment_query = (
            sa.select(
                segments.c.id,
                segments.c.tenant_id,
                segments.c.dataset_id,
                segments.c.document_id,
                segments.c.content,
            )
            .order_by(segments.c.id)
            .limit(500)
        )
        if segment_cursor is not None:
            segment_query = segment_query.where(segments.c.id > segment_cursor)
        with connection.execute(segment_query) as result:
            rows = result.all()
        if not rows:
            break
        _insert_existing_references(
            {
                "id": str(uuid4()),
                "tenant_id": row.tenant_id,
                "upload_file_id": file_id,
                "dataset_id": row.dataset_id,
                "document_id": row.document_id,
                "kind": "segment_image",
                "resource_id": row.id,
            }
            for row in rows
            for file_id in dict.fromkeys(extract_upload_file_ids_from_markdown(row.content or ""))
        )
        segment_cursor = rows[-1].id

    workflows = sa.table(
        "workflows",
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
    )
    draft_variables = sa.table(
        "workflow_draft_variables",
        sa.column("id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("node_id", sa.String(length=255)),
        sa.column("value_type", sa.String(length=20)),
        sa.column("value", sa.Text()),
    )
    draft_variable_cursor: str | None = None
    while True:
        draft_variable_query = (
            sa.select(
                draft_variables.c.id,
                draft_variables.c.app_id,
                draft_variables.c.node_id,
                draft_variables.c.value_type,
                draft_variables.c.value,
            )
            .where(draft_variables.c.value_type.in_(("file", "array[file]")))
            .order_by(draft_variables.c.id)
            .limit(500)
        )
        if draft_variable_cursor is not None:
            draft_variable_query = draft_variable_query.where(draft_variables.c.id > draft_variable_cursor)
        with connection.execute(draft_variable_query) as result:
            rows = result.all()
        if not rows:
            break
        app_ids = tuple({row.app_id for row in rows})
        workflow_owners = connection.execute(
            sa.select(workflows.c.app_id, workflows.c.tenant_id).where(workflows.c.app_id.in_(app_ids)).distinct()
        ).all()
        tenant_ids_by_app: dict[str, set[str]] = {}
        for owner in workflow_owners:
            tenant_ids_by_app.setdefault(owner.app_id, set()).add(owner.tenant_id)
        tenant_by_app = {
            app_id: next(iter(tenant_ids)) for app_id, tenant_ids in tenant_ids_by_app.items() if len(tenant_ids) == 1
        }
        _insert_existing_workflow_references(
            {
                "id": str(uuid4()),
                "tenant_id": tenant_id,
                "app_id": row.app_id,
                "draft_variable_id": row.id,
                "node_id": row.node_id,
                "upload_file_id": file_id,
            }
            for row in rows
            if (tenant_id := tenant_by_app.get(row.app_id)) is not None
            for file_id in resolve_upload_file_ids_from_serialized_file_value(
                value_type=row.value_type,
                value=row.value,
            )
        )
        draft_variable_cursor = rows[-1].id


def upgrade() -> None:
    with op.batch_alter_table("upload_files", schema=None) as batch_op:
        batch_op.add_column(sa.Column("knowledge_cleanup_started_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indexing_generation", StringUUID(), nullable=True))
    with op.batch_alter_table("document_segments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indexing_generation", StringUUID(), nullable=True))

    op.create_table(
        "knowledge_upload_file_references",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("upload_file_id", StringUUID(), nullable=False),
        sa.Column("dataset_id", StringUUID(), nullable=False),
        sa.Column("document_id", StringUUID(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("resource_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(["upload_file_id"], ["upload_files.id"]),
        sa.PrimaryKeyConstraint("id", name="knowledge_upload_file_reference_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "kind",
            "resource_id",
            "upload_file_id",
            name="knowledge_upload_file_reference_unique",
        ),
    )
    op.create_index(
        "knowledge_upload_file_reference_file_idx",
        "knowledge_upload_file_references",
        ["tenant_id", "upload_file_id"],
        unique=False,
    )
    op.create_index(
        "knowledge_upload_file_reference_document_idx",
        "knowledge_upload_file_references",
        ["tenant_id", "dataset_id", "document_id"],
        unique=False,
    )
    op.create_table(
        "workflow_draft_variable_upload_file_references",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("draft_variable_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("upload_file_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(
            ["draft_variable_id"],
            ["workflow_draft_variables.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["upload_file_id"], ["upload_files.id"]),
        sa.PrimaryKeyConstraint("id", name="workflow_draft_variable_upload_file_reference_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "draft_variable_id",
            "upload_file_id",
            name="workflow_draft_variable_upload_file_reference_unique",
        ),
    )
    op.create_index(
        "workflow_draft_variable_upload_file_reference_file_idx",
        "workflow_draft_variable_upload_file_references",
        ["tenant_id", "upload_file_id"],
        unique=False,
    )
    op.create_index(
        "workflow_draft_variable_upload_file_reference_owner_idx",
        "workflow_draft_variable_upload_file_references",
        ["tenant_id", "app_id", "node_id", "draft_variable_id"],
        unique=False,
    )
    # Reference rows are activated only after every legacy file-deletion path
    # understands the ownership tables.  Keep this revision schema-only so
    # older runtimes can continue deleting UploadFile rows during a rolling
    # deployment.


def downgrade() -> None:
    op.drop_index(
        "workflow_draft_variable_upload_file_reference_owner_idx",
        table_name="workflow_draft_variable_upload_file_references",
    )
    op.drop_index(
        "workflow_draft_variable_upload_file_reference_file_idx",
        table_name="workflow_draft_variable_upload_file_references",
    )
    op.drop_table("workflow_draft_variable_upload_file_references")
    op.drop_index(
        "knowledge_upload_file_reference_document_idx",
        table_name="knowledge_upload_file_references",
    )
    op.drop_index(
        "knowledge_upload_file_reference_file_idx",
        table_name="knowledge_upload_file_references",
    )
    op.drop_table("knowledge_upload_file_references")
    with op.batch_alter_table("document_segments", schema=None) as batch_op:
        batch_op.drop_column("indexing_generation")
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.drop_column("indexing_generation")
    with op.batch_alter_table("upload_files", schema=None) as batch_op:
        batch_op.drop_column("knowledge_cleanup_started_at")
