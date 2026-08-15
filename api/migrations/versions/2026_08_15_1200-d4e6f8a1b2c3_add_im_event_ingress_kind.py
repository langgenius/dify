"""Add IM event ingress kind and align inbox payload naming.

Revision ID: d4e6f8a1b2c3
Revises: c9e4f7a2b6d1
Create Date: 2026-08-15 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import models.types
from core.human_input_v2.im_provider import IMEventIngressKind

revision: str = "d4e6f8a1b2c3"
down_revision: str | None = "c9e4f7a2b6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "im_message_inbox"


def upgrade() -> None:
    op.add_column(
        _TABLE_NAME,
        sa.Column(
            "ingress_kind",
            models.types.EnumText(IMEventIngressKind),
            nullable=False,
        ),
    )
    op.alter_column(
        _TABLE_NAME,
        "raw_payload",
        new_column_name="payload",
        existing_type=models.types.LongText(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        _TABLE_NAME,
        "payload",
        new_column_name="raw_payload",
        existing_type=models.types.LongText(),
        existing_nullable=False,
    )
    op.drop_column(_TABLE_NAME, "ingress_kind")
