"""Add app_asset_contents table for inline content caching.

Revision ID: 5ee0aa981887
Revises: aab323465866
Create Date: 2026-03-09 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "5ee0aa981887"
down_revision = "aab323465866"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_asset_contents",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("node_id", models.types.StringUUID(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="app_asset_contents_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", "node_id", name="uq_asset_content_node"),
    )
    op.create_index("idx_asset_content_app", "app_asset_contents", ["tenant_id", "app_id"])


def downgrade() -> None:
    op.drop_index("idx_asset_content_app", table_name="app_asset_contents")
    op.drop_table("app_asset_contents")
