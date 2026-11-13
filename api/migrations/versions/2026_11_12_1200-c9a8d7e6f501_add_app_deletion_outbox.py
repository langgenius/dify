"""Persist App cleanup intent before committing deletion.

Revision ID: c9a8d7e6f501
Revises: b2e4c6d8a013
Create Date: 2026-11-12 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "c9a8d7e6f501"
down_revision = "b2e4c6d8a013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_deletion_outbox",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("deletion_payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_message", LongText(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_deletion_outbox_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", name="app_deletion_outbox_app_uq"),
        sa.CheckConstraint("attempt_count >= 0", name="app_deletion_outbox_attempt_ck"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'retry', 'succeeded')",
            name="app_deletion_outbox_status_ck",
        ),
        sa.CheckConstraint(
            "(status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (status != 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
            name="app_deletion_outbox_lease_ck",
        ),
        sa.CheckConstraint(
            "(status = 'succeeded' AND completed_at IS NOT NULL) "
            "OR (status != 'succeeded' AND completed_at IS NULL)",
            name="app_deletion_outbox_completed_ck",
        ),
    )
    op.create_index(
        "app_deletion_outbox_dispatch_idx",
        "app_deletion_outbox",
        ["status", "next_attempt_at", "id"],
    )
    op.create_index(
        "app_deletion_outbox_completed_idx",
        "app_deletion_outbox",
        ["status", "completed_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("app_deletion_outbox_completed_idx", table_name="app_deletion_outbox")
    op.drop_index("app_deletion_outbox_dispatch_idx", table_name="app_deletion_outbox")
    op.drop_table("app_deletion_outbox")
