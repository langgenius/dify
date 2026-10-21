"""add Agent Soul ToolFile ownership and cleanup claims

Revision ID: f9b3c7dae462
Revises: e8a2b6c9d351
Create Date: 2026-10-21 10:00:00.000000

Agent config drafts and snapshots may retain ToolFiles created by a
conversation. The normalized edge lets conversation cleanup preserve those
files, while the marker makes last-owner deletion recoverable after commit.
"""

import json
from collections.abc import Iterable, Mapping
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "f9b3c7dae462"
down_revision = "e8a2b6c9d351"
branch_labels = None
depends_on = None

_BACKFILL_BATCH_SIZE = 500


def _tool_file_ids(config_snapshot: object) -> tuple[str, ...]:
    if isinstance(config_snapshot, str):
        try:
            config_snapshot = json.loads(config_snapshot)
        except (TypeError, ValueError):
            return ()
    if not isinstance(config_snapshot, Mapping):
        return ()
    file_ids: list[str] = []
    config_files = config_snapshot.get("config_files")
    if isinstance(config_files, list):
        for item in config_files:
            if not isinstance(item, Mapping):
                continue
            file_id = item.get("file_id")
            if (
                item.get("file_kind") == "tool_file"
                and item.get("is_missing") is not True
                and isinstance(file_id, str)
                and file_id
            ):
                file_ids.append(file_id)
    config_skills = config_snapshot.get("config_skills")
    if isinstance(config_skills, list):
        for item in config_skills:
            if not isinstance(item, Mapping):
                continue
            file_id = item.get("file_id")
            if item.get("is_missing") is not True and isinstance(file_id, str) and file_id:
                file_ids.append(file_id)
    return tuple(dict.fromkeys(file_ids))


def _insert_references(rows: Iterable[dict[str, object]]) -> None:
    connection = op.get_bind()
    references = sa.table(
        "agent_config_tool_file_references",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("owner_kind", sa.String(length=16)),
        sa.column("owner_id", StringUUID()),
        sa.column("tool_file_id", StringUUID()),
    )
    tool_files = sa.table(
        "tool_files",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
    )
    unique_rows = {(row["tenant_id"], row["owner_kind"], row["owner_id"], row["tool_file_id"]): row for row in rows}
    if not unique_rows:
        return
    candidate_pairs = {(key[0], key[3]) for key in unique_rows}
    existing_pairs = set(
        connection.execute(
            sa.select(tool_files.c.tenant_id, tool_files.c.id).where(
                tool_files.c.tenant_id.in_(tuple({pair[0] for pair in candidate_pairs})),
                tool_files.c.id.in_(tuple({pair[1] for pair in candidate_pairs})),
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
        sa.column("agent_id", StringUUID()),
        sa.column("config_snapshot", sa.Text()),
    )
    agents = sa.table(
        "agents",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
    )
    cursor: str | None = None
    while True:
        statement = (
            sa.select(owners.c.id, owners.c.tenant_id, owners.c.config_snapshot)
            .join(
                agents,
                sa.and_(
                    agents.c.id == owners.c.agent_id,
                    agents.c.tenant_id == owners.c.tenant_id,
                ),
            )
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
                "tool_file_id": file_id,
            }
            for row in rows
            for file_id in _tool_file_ids(row.config_snapshot)
        )
        cursor = rows[-1].id


def upgrade() -> None:
    op.add_column("tool_files", sa.Column("cleanup_started_at", sa.DateTime(), nullable=True))
    op.create_index(
        "tool_file_cleanup_started_at_idx",
        "tool_files",
        ["cleanup_started_at"],
        unique=False,
    )
    op.create_table(
        "agent_config_tool_file_references",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("owner_kind", sa.String(length=16), nullable=False),
        sa.Column("owner_id", StringUUID(), nullable=False),
        sa.Column("tool_file_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(["tool_file_id"], ["tool_files.id"]),
        sa.PrimaryKeyConstraint("id", name="agent_config_tool_file_reference_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "owner_kind",
            "owner_id",
            "tool_file_id",
            name="agent_config_tool_file_reference_unique",
        ),
    )
    op.create_index(
        "agent_config_tool_file_reference_file_idx",
        "agent_config_tool_file_references",
        ["tenant_id", "tool_file_id"],
        unique=False,
    )
    op.create_index(
        "agent_config_tool_file_reference_owner_idx",
        "agent_config_tool_file_references",
        ["tenant_id", "owner_kind", "owner_id"],
        unique=False,
    )
    # Reference rows are activated only after every legacy file-deletion path
    # understands the ownership table.  Keep this revision schema-only during
    # rolling deployment.


def downgrade() -> None:
    op.drop_index(
        "agent_config_tool_file_reference_owner_idx",
        table_name="agent_config_tool_file_references",
    )
    op.drop_index(
        "agent_config_tool_file_reference_file_idx",
        table_name="agent_config_tool_file_references",
    )
    op.drop_table("agent_config_tool_file_references")
    op.drop_index("tool_file_cleanup_started_at_idx", table_name="tool_files")
    op.drop_column("tool_files", "cleanup_started_at")
