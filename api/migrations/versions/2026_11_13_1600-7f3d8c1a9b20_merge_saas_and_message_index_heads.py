"""Merge SaaS and message ownership index histories without schema changes.

Revision ID: 7f3d8c1a9b20
Revises: a7c4e2d9f681, 2c7e9a4b1d60
Create Date: 2026-11-13 16:00:00.000000
"""

revision = "7f3d8c1a9b20"
down_revision = ("a7c4e2d9f681", "2c7e9a4b1d60")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing heads without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
