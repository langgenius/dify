"""Add the file transfer table.

Revision ID: 3d9a6f1c2b84
Revises: 6b1d2f4e8a90
Create Date: 2026-11-20 10:00:00

"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "3d9a6f1c2b84"
down_revision = "6b1d2f4e8a90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "file_transfers",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("folder", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="file_transfers_pkey"),
        sa.CheckConstraint("direction IN ('in', 'out')", name="file_transfer_direction"),
    )
    op.create_index("file_transfer_owner_created_idx", "file_transfers", ["owner_id", "created_at"])
    op.create_index("file_transfer_expires_idx", "file_transfers", ["expires_at"])


def downgrade() -> None:
    op.drop_index("file_transfer_expires_idx", table_name="file_transfers")
    op.drop_index("file_transfer_owner_created_idx", table_name="file_transfers")
    op.drop_table("file_transfers")
