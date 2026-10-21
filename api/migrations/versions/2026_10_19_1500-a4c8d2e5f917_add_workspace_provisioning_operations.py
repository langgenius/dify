"""add workspace provisioning recovery records

Revision ID: a4c8d2e5f917
Revises: f3b9c1e4a826
Create Date: 2026-10-19 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "a4c8d2e5f917"
down_revision = "f3b9c1e4a826"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_provisioning_operations",
        sa.Column("workspace_id", models.types.StringUUID(), nullable=False),
        sa.Column("owner_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("lease_id", models.types.StringUUID(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("key_prepared", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("rbac_prepared", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("compensation_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("workspace_id", name="workspace_provisioning_operations_pkey"),
    )
    op.create_index(
        "workspace_provisioning_operations_recovery_idx",
        "workspace_provisioning_operations",
        ["status", "lease_expires_at", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("workspace_provisioning_operations_recovery_idx", table_name="workspace_provisioning_operations")
    op.drop_table("workspace_provisioning_operations")
