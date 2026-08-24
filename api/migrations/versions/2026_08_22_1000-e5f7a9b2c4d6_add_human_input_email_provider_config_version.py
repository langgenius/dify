"""Add a numeric configuration revision to Email providers.

Revision ID: e5f7a9b2c4d6
Revises: d4e6f8a1b2c3
Create Date: 2026-08-22 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f7a9b2c4d6"
down_revision: str | None = "d4e6f8a1b2c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "human_input_email_providers"


def upgrade() -> None:
    with op.batch_alter_table(_TABLE_NAME) as batch_op:
        batch_op.add_column(
            sa.Column(
                "config_version",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
                comment="Monotonic Email configuration revision used for compare-and-swap.",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table(_TABLE_NAME) as batch_op:
        batch_op.drop_column("config_version")
