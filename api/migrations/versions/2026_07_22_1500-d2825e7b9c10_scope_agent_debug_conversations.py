"""scope agent debug conversations by draft type

Revision ID: d2825e7b9c10
Revises: b8c9d0e1f2a3
Create Date: 2026-07-22 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "d2825e7b9c10"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade():
    # Existing pointers have always represented Build chat because the Agent
    # detail API exposes them as ``debug_conversation_id`` for that surface.
    op.add_column(
        "agent_debug_conversations",
        sa.Column(
            "draft_type",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'debug_build'"),
        ),
    )
    op.drop_constraint(
        "agent_debug_conversation_agent_account_unique",
        "agent_debug_conversations",
        type_="unique",
    )
    op.create_unique_constraint(
        "agent_debug_conversation_agent_account_draft_type_unique",
        "agent_debug_conversations",
        ["tenant_id", "agent_id", "account_id", "draft_type"],
    )


def downgrade():
    debug_conversations = sa.table(
        "agent_debug_conversations",
        sa.column("tenant_id", models.types.StringUUID()),
        sa.column("agent_id", models.types.StringUUID()),
        sa.column("account_id", models.types.StringUUID()),
        sa.column("draft_type", sa.String(length=32)),
    )
    build_conversations = debug_conversations.alias("build_conversations")
    op.get_bind().execute(
        sa.delete(debug_conversations).where(
            debug_conversations.c.draft_type == "draft",
            sa.exists(
                sa.select(sa.literal(1)).where(
                    build_conversations.c.tenant_id == debug_conversations.c.tenant_id,
                    build_conversations.c.agent_id == debug_conversations.c.agent_id,
                    build_conversations.c.account_id == debug_conversations.c.account_id,
                    build_conversations.c.draft_type == "debug_build",
                )
            ),
        )
    )
    op.drop_constraint(
        "agent_debug_conversation_agent_account_draft_type_unique",
        "agent_debug_conversations",
        type_="unique",
    )
    op.create_unique_constraint(
        "agent_debug_conversation_agent_account_unique",
        "agent_debug_conversations",
        ["tenant_id", "agent_id", "account_id"],
    )
    op.drop_column("agent_debug_conversations", "draft_type")
