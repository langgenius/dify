"""add app_asset_drafts table.

Revision ID: a1b2c3d4e5f6
Revises: 85c8b4a64f53
Create Date: 2026-01-14 12:15:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

revision = "a1b2c3d4e5f6"
down_revision = "85c8b4a64f53"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_asset_drafts",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("version", sa.String(length=255), nullable=False),
        sa.Column("asset_tree", models.types.LongText(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_asset_draft_pkey"),
    )
    with op.batch_alter_table("app_asset_drafts", schema=None) as batch_op:
        batch_op.create_index("app_asset_draft_version_idx", ["tenant_id", "app_id", "version"], unique=False)


def downgrade():
    op.drop_table("app_asset_drafts")
