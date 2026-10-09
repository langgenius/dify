"""Persist Human Input v2 deliveries and attempts.

Revision ID: f3c5e7a9b1d2
Revises: e2b4d6f8a0c1
Create Date: 2026-09-21 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision: str = "f3c5e7a9b1d2"
down_revision: str | None = "e2b4d6f8a0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hitlv2_deliveries",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("recipient_id", StringUUID(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("auth_type", sa.Text(), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("hitlv2_deliveries_token_idx", "hitlv2_deliveries", ["token_hash"])
    op.create_index("hitlv2_deliveries_form_target_idx", "hitlv2_deliveries", ["form_id", "target_type"])
    op.create_table(
        "hitlv2_delivery_attempts",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("delivery_id", StringUUID(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error_message", sa.String(200), nullable=True),
        sa.Column("response", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )


def downgrade() -> None:
    op.drop_table("hitlv2_delivery_attempts")
    op.drop_table("hitlv2_deliveries")
