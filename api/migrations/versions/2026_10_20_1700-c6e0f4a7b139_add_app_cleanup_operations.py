"""add durable App cleanup operations

Revision ID: c6e0f4a7b139
Revises: b5d9e3f6a028
Create Date: 2026-10-20 17:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "c6e0f4a7b139"
down_revision = "b5d9e3f6a028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_cleanup_operations",
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("available_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("lease_id", models.types.StringUUID(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("app_id", name="app_cleanup_operations_pkey"),
    )
    op.create_index(
        "app_cleanup_operations_recovery_idx",
        "app_cleanup_operations",
        ["status", "available_at", "lease_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("app_cleanup_operations_recovery_idx", table_name="app_cleanup_operations")
    op.drop_table("app_cleanup_operations")
