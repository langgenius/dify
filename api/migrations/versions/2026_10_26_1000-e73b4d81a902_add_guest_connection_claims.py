"""Record one Account claim per Guest credential identity.

Revision ID: e73b4d81a902
Revises: f3a6b9c2d108
Create Date: 2026-10-26 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "e73b4d81a902"
down_revision = "f3a6b9c2d108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "end_user_connection_claims",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("account_end_user_id", StringUUID(), nullable=False),
        sa.Column("connection_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_claims_pkey"),
        sa.UniqueConstraint("end_user_id", name="end_user_connection_claim_guest_key"),
        sa.CheckConstraint("connection_count >= 0", name=sa.schema.conv("end_user_connection_claim_count_check")),
    )


def downgrade() -> None:
    op.drop_table("end_user_connection_claims")
