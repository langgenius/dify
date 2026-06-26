"""add enterprise marketplace assets

Revision ID: c8f3d9d4a1be
Revises: 227822d22895
Create Date: 2026-04-30 21:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "c8f3d9d4a1be"
down_revision = "227822d22895"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "enterprise_marketplace_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_tenant_id", sa.String(length=36), nullable=False),
        sa.Column("source_app_id", sa.String(length=36), nullable=False),
        sa.Column("submitter_account_id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_account_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=255), nullable=False, server_default="General"),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("scenario", sa.Text(), nullable=False, server_default=""),
        sa.Column("allow_show_workspace_name", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="enterprise_marketplace_asset_pkey"),
        sa.UniqueConstraint("source_app_id", name="unique_enterprise_marketplace_source_app"),
    )
    op.create_index(
        "enterprise_marketplace_asset_source_tenant_id_idx",
        "enterprise_marketplace_assets",
        ["source_tenant_id"],
        unique=False,
    )
    op.create_index(
        "enterprise_marketplace_asset_status_idx",
        "enterprise_marketplace_assets",
        ["status", "updated_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("enterprise_marketplace_asset_status_idx", table_name="enterprise_marketplace_assets")
    op.drop_index("enterprise_marketplace_asset_source_tenant_id_idx", table_name="enterprise_marketplace_assets")
    op.drop_table("enterprise_marketplace_assets")
