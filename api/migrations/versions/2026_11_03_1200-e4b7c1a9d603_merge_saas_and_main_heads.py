"""Merge SaaS and main migration heads without changing the database schema.

Revision ID: e4b7c1a9d603
Revises: 53c10126d551, c7f2a8d9e041
Create Date: 2026-11-03 12:00:00.000000
"""

revision = "e4b7c1a9d603"
down_revision = ("53c10126d551", "c7f2a8d9e041")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
