"""Merge SaaS and file scan histories without schema changes.

Revision ID: c3a8e5d1f902
Revises: 9c4a7e2b1d60, 9f2c7a6e4b31
Create Date: 2026-11-16 12:00:00.000000
"""

revision = "c3a8e5d1f902"
down_revision = ("9c4a7e2b1d60", "9f2c7a6e4b31")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing heads without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
