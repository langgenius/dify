"""add agent config drafts

Revision ID: e4f5a6b7c8d9
Revises: a6f1c9d2e8b4
Create Date: 2026-06-24 20:15:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "e4f5a6b7c8d9"
down_revision = "a6f1c9d2e8b4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agent_config_drafts",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("draft_type", sa.String(length=32), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=True),
        sa.Column("draft_owner_key", sa.String(length=255), nullable=False),
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


def downgrade():
    op.drop_index("agent_config_draft_base_snapshot_idx", table_name="agent_config_drafts")
    op.drop_index("agent_config_draft_tenant_agent_idx", table_name="agent_config_drafts")
    op.drop_table("agent_config_drafts")
