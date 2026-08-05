"""add agent debug conversations

Revision ID: c8f4a6b2d3e1
Revises: b2515f9d4c2a
Create Date: 2026-06-22 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c8f4a6b2d3e1"
down_revision = "b2515f9d4c2a"
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
        "agent_debug_conversations",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("conversation_id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_debug_conversation_pkey")),
        sa.UniqueConstraint(
            "tenant_id",
            "agent_id",
            "account_id",
            name=op.f("agent_debug_conversation_agent_account_unique"),
        ),
    )
    op.create_index(
        "agent_debug_conversation_conversation_idx",
        "agent_debug_conversations",
        ["conversation_id"],
    )
    op.create_index(
        "agent_debug_conversation_account_idx",
        "agent_debug_conversations",
        ["tenant_id", "account_id"],
    )


def downgrade():
    op.drop_index("agent_debug_conversation_account_idx", table_name="agent_debug_conversations")
    op.drop_index("agent_debug_conversation_conversation_idx", table_name="agent_debug_conversations")
    op.drop_table("agent_debug_conversations")
