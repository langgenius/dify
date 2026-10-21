"""add Agent Soul config-file ownership edges

Revision ID: d7f1a5b8c240
Revises: c6e0f4a7b139
Create Date: 2026-10-20 18:00:00.000000

Drafts and immutable snapshots both own local UploadFile entries embedded in
their Agent Soul JSON. The bounded backfill makes those pre-existing owners
visible to the shared upload cleanup fence.
"""

import json
from collections.abc import Iterable, Mapping
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "d7f1a5b8c240"
down_revision = "c6e0f4a7b139"
branch_labels = None
depends_on = None

_BACKFILL_BATCH_SIZE = 500


def _upload_file_ids(config_snapshot: object) -> tuple[str, ...]:
    if isinstance(config_snapshot, str):
        try:
            config_snapshot = json.loads(config_snapshot)
        except (TypeError, ValueError):
            return ()
    if not isinstance(config_snapshot, Mapping):
        return ()
    config_files = config_snapshot.get("config_files")
    if not isinstance(config_files, list):
        return ()
    file_ids: list[str] = []
    for item in config_files:
        if not isinstance(item, Mapping):
            continue
        file_id = item.get("file_id")
        if (
            item.get("file_kind") == "upload_file"
            and item.get("is_missing") is not True
            and isinstance(file_id, str)
            and file_id
        ):
            file_ids.append(file_id)
    return tuple(dict.fromkeys(file_ids))


def _insert_references(rows: Iterable[dict[str, object]]) -> None:
    connection = op.get_bind()
    references = sa.table(
        "agent_config_upload_file_references",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("owner_kind", sa.String(length=16)),
        sa.column("owner_id", StringUUID()),
        sa.column("upload_file_id", StringUUID()),
    )
    upload_files = sa.table(
        "upload_files",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
    )
    unique_rows = {(row["tenant_id"], row["owner_kind"], row["owner_id"], row["upload_file_id"]): row for row in rows}
    if not unique_rows:
        return
    candidate_pairs = {(key[0], key[3]) for key in unique_rows}
    existing_pairs = set(
        connection.execute(
            sa.select(upload_files.c.tenant_id, upload_files.c.id).where(
                upload_files.c.tenant_id.in_(tuple({pair[0] for pair in candidate_pairs})),
                upload_files.c.id.in_(tuple({pair[1] for pair in candidate_pairs})),
            )
        ).all()
    )
    valid_rows = [row for key, row in unique_rows.items() if (key[0], key[3]) in existing_pairs]
    if valid_rows:
        connection.execute(sa.insert(references), valid_rows)


def _backfill_owner_table(*, table_name: str, owner_kind: str) -> None:
    connection = op.get_bind()
    owners = sa.table(
        table_name,
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("config_snapshot", sa.Text()),
    )
    cursor: str | None = None
    while True:
        statement = (
            sa.select(owners.c.id, owners.c.tenant_id, owners.c.config_snapshot)
            .order_by(owners.c.id)
            .limit(_BACKFILL_BATCH_SIZE)
        )
        if cursor is not None:
            statement = statement.where(owners.c.id > cursor)
        rows = connection.execute(statement).all()
        if not rows:
            return
        _insert_references(
            {
                "id": str(uuid4()),
                "tenant_id": row.tenant_id,
                "owner_kind": owner_kind,
                "owner_id": row.id,
                "upload_file_id": file_id,
            }
            for row in rows
            for file_id in _upload_file_ids(row.config_snapshot)
        )
        cursor = rows[-1].id


def upgrade() -> None:
    op.create_table(
        "agent_config_upload_file_references",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("owner_kind", sa.String(length=16), nullable=False),
        sa.Column("owner_id", StringUUID(), nullable=False),
        sa.Column("upload_file_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(["upload_file_id"], ["upload_files.id"]),
        sa.PrimaryKeyConstraint("id", name="agent_config_upload_file_reference_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "owner_kind",
            "owner_id",
            "upload_file_id",
            name="agent_config_upload_file_reference_unique",
        ),
    )
    op.create_index(
        "agent_config_upload_file_reference_file_idx",
        "agent_config_upload_file_references",
        ["tenant_id", "upload_file_id"],
        unique=False,
    )
    op.create_index(
        "agent_config_upload_file_reference_owner_idx",
        "agent_config_upload_file_references",
        ["tenant_id", "owner_kind", "owner_id"],
        unique=False,
    )
    if op.get_context().as_sql:
        op.execute(
            "-- Agent-config upload-file reference backfill requires an online upgrade; "
            "offline SQL renders DDL for review only."
        )
    else:
        _backfill_owner_table(table_name="agent_config_drafts", owner_kind="draft")
        _backfill_owner_table(table_name="agent_config_snapshots", owner_kind="snapshot")


def downgrade() -> None:
    op.drop_index(
        "agent_config_upload_file_reference_owner_idx",
        table_name="agent_config_upload_file_references",
    )
    op.drop_index(
        "agent_config_upload_file_reference_file_idx",
        table_name="agent_config_upload_file_references",
    )
    op.drop_table("agent_config_upload_file_references")
