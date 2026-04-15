"""add_customized_snippets_table

Revision ID: 1c05e80d2380
Revises: 788d3099ae3a
Create Date: 2026-01-29 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

import models as models


def _is_pg(conn):
    return conn.dialect.name == "postgresql"


# revision identifiers, used by Alembic.
revision = "1c05e80d2380"
down_revision = "788d3099ae3a"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    if _is_pg(conn):
        op.create_table(
            "customized_snippets",
            sa.Column("id", models.types.StringUUID(), server_default=sa.text("uuidv7()"), nullable=False),
            sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("type", sa.String(length=50), server_default=sa.text("'node'"), nullable=False),
            sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
            sa.Column("is_published", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
            sa.Column("use_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("icon_info", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("graph", sa.Text(), nullable=True),
            sa.Column("input_fields", sa.Text(), nullable=True),
            sa.Column("created_by", models.types.StringUUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column("updated_by", models.types.StringUUID(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.PrimaryKeyConstraint("id", name="customized_snippet_pkey"),
            sa.UniqueConstraint("tenant_id", "name", name="customized_snippet_tenant_name_key"),
        )
    else:
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
            sa.Column("icon_info", models.types.AdjustedJSON(astext_type=sa.Text()), nullable=True),
            sa.Column("graph", models.types.LongText(), nullable=True),
            sa.Column("input_fields", models.types.LongText(), nullable=True),
            sa.Column("created_by", models.types.StringUUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.Column("updated_by", models.types.StringUUID(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.PrimaryKeyConstraint("id", name="customized_snippet_pkey"),
            sa.UniqueConstraint("tenant_id", "name", name="customized_snippet_tenant_name_key"),
        )

    with op.batch_alter_table("customized_snippets", schema=None) as batch_op:
        batch_op.create_index("customized_snippet_tenant_idx", ["tenant_id"], unique=False)


def downgrade():
    with op.batch_alter_table("customized_snippets", schema=None) as batch_op:
        batch_op.drop_index("customized_snippet_tenant_idx")

    op.drop_table("customized_snippets")
