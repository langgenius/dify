"""Add the Account first-use timestamp without backfilling historical usage.

Revision ID: 8d2f6a9c4b71
Revises: 6a1f3e8c2d47
"""

import sqlalchemy as sa
from alembic import op

revision = "8d2f6a9c4b71"
down_revision = "6a1f3e8c2d47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("first_app_used_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "first_app_used_at")
