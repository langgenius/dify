"""Preserve callback request IPs for asynchronous Human Input v2 auditing.

Revision ID: b9e3f5a7c1d4
Revises: 6a8c0e2f4b7d
Create Date: 2026-10-23 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9e3f5a7c1d4"
down_revision: str | None = "6a8c0e2f4b7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "im_message_inbox",
        sa.Column(
            "request_ip_address",
            sa.Text(),
            nullable=True,
            comment="HTTP request IP when available; absent for stream and historical events.",
        ),
    )


def downgrade() -> None:
    op.drop_column("im_message_inbox", "request_ip_address")
