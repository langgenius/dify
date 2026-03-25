"""add explore_app_folders table and folder_id to installed_apps

Revision ID: a1b2c3d4e5f6
Revises: 58eb7bdb93fe
Create Date: 2025-07-01 00:00:01

Adds:
- explore_app_folders table: per-tenant folders for sidebar app grouping
- installed_apps.folder_id: nullable FK to explore_app_folders.id
"""

import sqlalchemy as sa
from alembic import op

import models.types

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "6b5f9f8b1a2c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create the explore_app_folders table
    op.create_table(
        "explore_app_folders",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id", name="explore_app_folder_pkey"),
    )
    op.create_index("explore_app_folder_tenant_id_idx", "explore_app_folders", ["tenant_id"])

    # Add folder_id to installed_apps (nullable, no FK constraint to keep it simple)
    op.add_column(
        "installed_apps",
        sa.Column("folder_id", models.types.StringUUID(), nullable=True, server_default=None),
    )


def downgrade() -> None:
    op.drop_column("installed_apps", "folder_id")
    op.drop_index("explore_app_folder_tenant_id_idx", table_name="explore_app_folders")
    op.drop_table("explore_app_folders")

