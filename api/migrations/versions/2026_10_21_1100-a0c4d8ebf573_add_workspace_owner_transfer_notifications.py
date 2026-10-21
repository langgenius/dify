"""add durable workspace owner transfer notifications

Revision ID: a0c4d8ebf573
Revises: f9b3c7dae462
Create Date: 2026-10-21 11:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "a0c4d8ebf573"
down_revision = "f9b3c7dae462"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_owner_transfer_notifications",
        sa.Column("notification_id", StringUUID(), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("workspace_id", StringUUID(), nullable=False),
        sa.Column("old_owner_account_id", StringUUID(), nullable=False),
        sa.Column("new_owner_account_id", StringUUID(), nullable=False),
        sa.Column("recipient_type", sa.String(length=16), nullable=False),
        sa.Column("recipient_email", sa.String(length=255), nullable=False),
        sa.Column("recipient_language", sa.String(length=64), nullable=False),
        sa.Column("workspace_name", sa.String(length=255), nullable=False),
        sa.Column("new_owner_email", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="waiting", nullable=False),
        sa.Column("claim_id", StringUUID(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("notification_id", name="workspace_owner_transfer_notifications_pkey"),
        sa.UniqueConstraint(
            "operation_id",
            "recipient_type",
            name="workspace_owner_transfer_notifications_operation_recipient_key",
        ),
    )
    op.create_index(
        "workspace_owner_transfer_notifications_delivery_idx",
        "workspace_owner_transfer_notifications",
        ["status", "next_attempt_at", "lease_expires_at", "notification_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "workspace_owner_transfer_notifications_delivery_idx",
        table_name="workspace_owner_transfer_notifications",
    )
    op.drop_table("workspace_owner_transfer_notifications")
