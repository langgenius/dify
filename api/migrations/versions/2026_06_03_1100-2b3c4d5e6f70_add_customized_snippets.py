"""add customized snippets

Revision ID: 2b3c4d5e6f70
Revises: 8d4c2a1b9f03
Create Date: 2026-06-03 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

# revision identifiers, used by Alembic.
revision = "2b3c4d5e6f70"
down_revision = "8d4c2a1b9f03"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _current_timestamp_default():
    return sa.text("CURRENT_TIMESTAMP(0)") if _is_pg() else sa.func.current_timestamp()


def upgrade() -> None:
    op.create_table(
        "customized_snippets",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", models.types.LongText(), nullable=True),
        sa.Column("type", sa.String(length=50), server_default=sa.text("'node'"), nullable=False),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
        sa.Column("is_published", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("use_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("icon_info", models.types.AdjustedJSON(), nullable=True),
        sa.Column("input_fields", models.types.LongText(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="customized_snippet_pkey"),
    )

    with op.batch_alter_table("customized_snippets", schema=None) as batch_op:
        batch_op.create_index("customized_snippet_tenant_idx", ["tenant_id"], unique=False)

    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("kind", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.drop_column("kind")

    with op.batch_alter_table("customized_snippets", schema=None) as batch_op:
        batch_op.drop_index("customized_snippet_tenant_idx")

    op.drop_table("customized_snippets")
