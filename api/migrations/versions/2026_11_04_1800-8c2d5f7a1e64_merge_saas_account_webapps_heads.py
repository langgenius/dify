"""Merge SaaS and Account WebApp migration heads without changing the database schema.

Revision ID: 8c2d5f7a1e64
Revises: f6a2c8e4b901, b43e8c1d9a72, 6a1f3e8c2d47
Create Date: 2026-11-04 18:00:00.000000
"""

revision = "8c2d5f7a1e64"
down_revision = ("f6a2c8e4b901", "b43e8c1d9a72", "6a1f3e8c2d47")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
