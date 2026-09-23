"""Persist Human Input v2 verification audit events independently of Redis.

Revision ID: a8d2f4b6c0e3
Revises: f3c5e7a9b1d2
Create Date: 2026-09-23 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision: str = "a8d2f4b6c0e3"
down_revision: str | None = "f3c5e7a9b1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hitlv2_audit_events",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("payload", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )


def downgrade() -> None:
    op.drop_table("hitlv2_audit_events")
