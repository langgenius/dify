"""add resource access token tables

Revision ID: a8c9e2f1b704
Revises: d8e4a6b1c902
Create Date: 2026-08-18 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

import models.types


def _is_pg(conn):
    return conn.dialect.name == "postgresql"


# revision identifiers, used by Alembic.
revision = "a8c9e2f1b704"
down_revision = "d8e4a6b1c902"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    if _is_pg(conn):
        op.create_table(
            "resource_access_tokens",
            sa.Column("id", postgresql.UUID(), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("track_id", sa.String(length=32), nullable=False),
            sa.Column("token", sa.String(length=255), nullable=False),
            sa.Column("created_by", postgresql.UUID(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP(0)"), nullable=False),
            sa.PrimaryKeyConstraint("id", name="resource_access_token_pkey"),
        )
        op.create_table(
            "resource_access_tokens_relation",
            sa.Column("id", postgresql.UUID(), nullable=False),
            sa.Column("token_id", postgresql.UUID(), nullable=False),
            sa.Column("resource_type", sa.String(length=16), nullable=False),
            sa.Column("app_id", postgresql.UUID(), nullable=True),
            sa.Column("dataset_id", postgresql.UUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP(0)"), nullable=False),
            sa.CheckConstraint(
                "(resource_type = 'app' AND app_id IS NOT NULL AND dataset_id IS NULL) OR "
                "(resource_type = 'knowledge' AND dataset_id IS NOT NULL AND app_id IS NULL)",
                name="resource_access_token_relation_resource_check",
            ),
            sa.PrimaryKeyConstraint("id", name="resource_access_token_relation_pkey"),
        )
    else:
        op.create_table(
            "resource_access_tokens",
            sa.Column("id", models.types.StringUUID(), nullable=False),
            sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("track_id", sa.String(length=32), nullable=False),
            sa.Column("token", sa.String(length=255), nullable=False),
            sa.Column("created_by", models.types.StringUUID(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.PrimaryKeyConstraint("id", name="resource_access_token_pkey"),
        )
        op.create_table(
            "resource_access_tokens_relation",
            sa.Column("id", models.types.StringUUID(), nullable=False),
            sa.Column("token_id", models.types.StringUUID(), nullable=False),
            sa.Column("resource_type", sa.String(length=16), nullable=False),
            sa.Column("app_id", models.types.StringUUID(), nullable=True),
            sa.Column("dataset_id", models.types.StringUUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
            sa.CheckConstraint(
                "(resource_type = 'app' AND app_id IS NOT NULL AND dataset_id IS NULL) OR "
                "(resource_type = 'knowledge' AND dataset_id IS NOT NULL AND app_id IS NULL)",
                name="resource_access_token_relation_resource_check",
            ),
            sa.PrimaryKeyConstraint("id", name="resource_access_token_relation_pkey"),
        )

    with op.batch_alter_table("resource_access_tokens", schema=None) as batch_op:
        batch_op.create_index("resource_access_token_tenant_idx", ["tenant_id"], unique=False)
        batch_op.create_index("resource_access_token_token_idx", ["token"], unique=True)
        batch_op.create_index("resource_access_token_track_id_idx", ["track_id"], unique=True)

    with op.batch_alter_table("resource_access_tokens_relation", schema=None) as batch_op:
        batch_op.create_index("resource_access_token_relation_token_idx", ["token_id"], unique=False)
        batch_op.create_index("resource_access_token_relation_app_idx", ["app_id"], unique=False)
        batch_op.create_index("resource_access_token_relation_dataset_idx", ["dataset_id"], unique=False)
        batch_op.create_unique_constraint(
            "resource_access_token_relation_app_unique",
            ["token_id", "resource_type", "app_id"],
        )
        batch_op.create_unique_constraint(
            "resource_access_token_relation_dataset_unique",
            ["token_id", "resource_type", "dataset_id"],
        )


def downgrade():
    op.drop_table("resource_access_tokens_relation")
    op.drop_table("resource_access_tokens")
