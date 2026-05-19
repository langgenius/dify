"""add agent config revisions

Revision ID: f8b6b7e9c421
Revises: c6a9f4b12d3e
Create Date: 2026-05-19 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "f8b6b7e9c421"
down_revision = "c6a9f4b12d3e"
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
        "agent_config_revisions",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("previous_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("current_snapshot_id", models.types.StringUUID(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("summary", models.types.LongText(), nullable=True),
        sa.Column("version_note", models.types.LongText(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_config_revision_pkey")),
        sa.UniqueConstraint(
            "agent_id",
            "revision",
            name=op.f("agent_config_revision_agent_revision_unique"),
        ),
    )
    op.create_index(
        "agent_config_revision_tenant_agent_created_at_idx",
        "agent_config_revisions",
        ["tenant_id", "agent_id", "created_at"],
    )
    op.create_index(
        "agent_config_revision_tenant_current_snapshot_created_at_idx",
        "agent_config_revisions",
        ["tenant_id", "current_snapshot_id", "created_at"],
    )


def downgrade():
    op.drop_index(
        "agent_config_revision_tenant_current_snapshot_created_at_idx",
        table_name="agent_config_revisions",
    )
    op.drop_index(
        "agent_config_revision_tenant_agent_created_at_idx",
        table_name="agent_config_revisions",
    )
    op.drop_table("agent_config_revisions")
