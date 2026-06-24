"""add agent config drafts

Revision ID: e4f5a6b7c8d9
Revises: d9e8f7a6b5c4
Create Date: 2026-06-24 20:15:00.000000

"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

import models
from libs.uuid_utils import uuidv7

# revision identifiers, used by Alembic.
revision = "e4f5a6b7c8d9"
down_revision = "d9e8f7a6b5c4"
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    kwargs = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg(op.get_bind()):
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade():
    op.create_table(
        "agent_config_drafts",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("draft_type", sa.String(length=32), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=True),
        sa.Column("draft_owner_key", sa.String(length=255), server_default="", nullable=False),
        sa.Column("base_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("config_snapshot", models.types.LongText(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_config_draft_pkey")),
        sa.UniqueConstraint(
            "tenant_id",
            "agent_id",
            "draft_type",
            "draft_owner_key",
            name=op.f("agent_config_draft_agent_type_account_unique"),
        ),
    )
    op.create_index("agent_config_draft_tenant_agent_idx", "agent_config_drafts", ["tenant_id", "agent_id"])
    op.create_index(
        "agent_config_draft_base_snapshot_idx",
        "agent_config_drafts",
        ["tenant_id", "base_snapshot_id"],
    )

    bind = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                INSERT INTO agent_config_drafts (
                    id, tenant_id, agent_id, draft_type, account_id, draft_owner_key, base_snapshot_id,
                    config_snapshot, created_by, updated_by, created_at, updated_at
                )
                SELECT
                    uuidv7(), a.tenant_id, a.id, 'draft', NULL, '', s.id,
                    s.config_snapshot, a.created_by, a.updated_by, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM agents a
                JOIN agent_config_snapshots s
                    ON s.tenant_id = a.tenant_id
                    AND s.agent_id = a.id
                    AND s.id = a.active_config_snapshot_id
                WHERE a.active_config_snapshot_id IS NOT NULL
                """
            )
        )
    else:
        agents = bind.execute(
            sa.text(
                """
                SELECT
                    a.tenant_id, a.id AS agent_id, a.created_by, a.updated_by,
                    s.id AS snapshot_id, s.config_snapshot
                FROM agents a
                JOIN agent_config_snapshots s
                    ON s.tenant_id = a.tenant_id
                    AND s.agent_id = a.id
                    AND s.id = a.active_config_snapshot_id
                WHERE a.active_config_snapshot_id IS NOT NULL
                """
            )
        ).mappings()
        for row in agents:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO agent_config_drafts (
                        id, tenant_id, agent_id, draft_type, account_id, draft_owner_key, base_snapshot_id,
                        config_snapshot, created_by, updated_by, created_at, updated_at
                    )
                    VALUES (
                        :id, :tenant_id, :agent_id, 'draft', NULL, '', :snapshot_id,
                        :config_snapshot, :created_by, :updated_by, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": str(uuidv7()),
                    "tenant_id": row["tenant_id"],
                    "agent_id": row["agent_id"],
                    "snapshot_id": row["snapshot_id"],
                    "config_snapshot": row["config_snapshot"],
                    "created_by": row["created_by"],
                    "updated_by": row["updated_by"],
                    "created_at": now,
                    "updated_at": now,
                },
            )


def downgrade():
    op.drop_index("agent_config_draft_base_snapshot_idx", table_name="agent_config_drafts")
    op.drop_index("agent_config_draft_tenant_agent_idx", table_name="agent_config_drafts")
    op.drop_table("agent_config_drafts")
