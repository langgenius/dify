"""Add Human Input v2 recipients with form-scoped subject uniqueness.

Revision ID: b8d0f2a4c6e9
Revises: a7c9e1f3b5d8
Create Date: 2026-09-10 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision: str = "b8d0f2a4c6e9"
down_revision: str | None = "a7c9e1f3b5d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hitlv2_recipients",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("subject_type", sa.String(20), nullable=False),
        sa.Column("subject_value", sa.String(255), nullable=False),
        sa.Column("sources", LongText(), nullable=False),
        sa.Column("snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="hitlv2_recipients_pkey"),
        sa.UniqueConstraint("form_id", "subject_type", "subject_value", name="hitlv2_recipients_subject_uq"),
    )


def downgrade() -> None:
    op.drop_table("hitlv2_recipients")
