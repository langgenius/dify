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


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    kwargs = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg(op.get_bind()):
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    return any(
        column["name"] == column_name for column in sa.inspect(op.get_bind()).get_columns(table_name)
    )


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    return any(
        constraint["name"] == constraint_name
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(table_name)
    )


def upgrade():
    if not _has_table("agent_debug_conversations"):
        op.create_table(
            "agent_debug_conversations",
            _uuid_column("id", primary_key=True),
            sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
            sa.Column("agent_id", models.types.StringUUID(), nullable=False),
            sa.Column("app_id", models.types.StringUUID(), nullable=False),
            sa.Column("account_id", models.types.StringUUID(), nullable=False),
            sa.Column("conversation_id", models.types.StringUUID(), nullable=False),
            sa.Column(
                "draft_type",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'debug_build'"),
            ),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("agent_debug_conversation_pkey")),
            sa.UniqueConstraint(
                "tenant_id",
                "agent_id",
                "account_id",
                "draft_type",
                name=op.f("agent_debug_conversation_agent_account_draft_type_unique"),
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
        return

    # Existing pointers have always represented Build chat because the Agent
    # detail API exposes them as ``debug_conversation_id`` for that surface.
    if not _has_column("agent_debug_conversations", "draft_type"):
        op.add_column(
            "agent_debug_conversations",
            sa.Column(
                "draft_type",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'debug_build'"),
            ),
        )
    if _has_unique_constraint(
        "agent_debug_conversations",
        "agent_debug_conversation_agent_account_unique",
    ):
        op.drop_constraint(
            "agent_debug_conversation_agent_account_unique",
            "agent_debug_conversations",
            type_="unique",
        )
    if not _has_unique_constraint(
        "agent_debug_conversations",
        "agent_debug_conversation_agent_account_draft_type_unique",
    ):
        op.create_unique_constraint(
            "agent_debug_conversation_agent_account_draft_type_unique",
            "agent_debug_conversations",
            ["tenant_id", "agent_id", "account_id", "draft_type"],
        )


def downgrade():
    if not _has_table("agent_debug_conversations"):
        return

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
    if _has_unique_constraint(
        "agent_debug_conversations",
        "agent_debug_conversation_agent_account_draft_type_unique",
    ):
        op.drop_constraint(
            "agent_debug_conversation_agent_account_draft_type_unique",
            "agent_debug_conversations",
            type_="unique",
        )
    if not _has_unique_constraint(
        "agent_debug_conversations",
        "agent_debug_conversation_agent_account_unique",
    ):
        op.create_unique_constraint(
            "agent_debug_conversation_agent_account_unique",
            "agent_debug_conversations",
            ["tenant_id", "agent_id", "account_id"],
        )
    if _has_column("agent_debug_conversations", "draft_type"):
        op.drop_column("agent_debug_conversations", "draft_type")
