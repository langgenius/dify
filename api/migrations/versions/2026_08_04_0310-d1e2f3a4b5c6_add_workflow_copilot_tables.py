"""add workflow copilot tables

Revision ID: d1e2f3a4b5c6
Revises: e4708db55c1d
Create Date: 2026-08-04 03:10:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "d1e2f3a4b5c6"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_copilot_conversations",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("title", sa.String(length=255), server_default="", nullable=False),
        sa.Column("summary", models.types.LongText(), nullable=False),
        sa.Column("summarized_message_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_copilot_conversation_pkey")),
    )
    op.create_index(
        "workflow_copilot_conversation_owner_idx",
        "workflow_copilot_conversations",
        ["tenant_id", "app_id", "account_id"],
    )

    op.create_table(
        "workflow_copilot_messages",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("conversation_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", models.types.LongText(), nullable=False),
        sa.Column("tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_copilot_message_pkey")),
    )
    op.create_index(
        "workflow_copilot_message_conversation_idx",
        "workflow_copilot_messages",
        ["conversation_id", "created_at"],
    )


def downgrade():
    op.drop_index("workflow_copilot_message_conversation_idx", table_name="workflow_copilot_messages")
    op.drop_table("workflow_copilot_messages")
    op.drop_index("workflow_copilot_conversation_owner_idx", table_name="workflow_copilot_conversations")
    op.drop_table("workflow_copilot_conversations")
