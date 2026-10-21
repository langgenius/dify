"""add recoverable workspace owner transfer operations

Revision ID: e8a2b6c9d351
Revises: d7f1a5b8c240
Create Date: 2026-10-20 19:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "e8a2b6c9d351"
down_revision = "d7f1a5b8c240"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_owner_transfer_operations",
        sa.Column("workspace_id", StringUUID(), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("old_owner_account_id", StringUUID(), nullable=False),
        sa.Column("new_owner_account_id", StringUUID(), nullable=False),
        sa.Column("possible_owner_account_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("execution_id", StringUUID(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("next_reconcile_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("workspace_id", name="workspace_owner_transfer_operations_pkey"),
    )
    op.create_index(
        "workspace_owner_transfer_operations_recovery_idx",
        "workspace_owner_transfer_operations",
        ["status", "next_reconcile_at", "updated_at", "workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "workspace_owner_transfer_operations_recovery_idx",
        table_name="workspace_owner_transfer_operations",
    )
    op.drop_table("workspace_owner_transfer_operations")
