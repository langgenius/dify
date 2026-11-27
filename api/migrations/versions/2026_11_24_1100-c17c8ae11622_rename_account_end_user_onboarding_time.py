"""Retain known first App use as the historical baseline for End User onboarding.

Revision ID: c17c8ae11622
Revises: b6d8f2a4c901
"""

import sqlalchemy as sa
from alembic import op

revision = "c17c8ae11622"
down_revision = "b6d8f2a4c901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "accounts",
        "first_app_used_at",
        new_column_name="be_end_user_at",
        existing_type=sa.DateTime(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "accounts",
        "be_end_user_at",
        new_column_name="first_app_used_at",
        existing_type=sa.DateTime(),
        existing_nullable=True,
    )
