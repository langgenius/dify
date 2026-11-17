"""Merge SaaS and EndUser authentication migration histories.

Revision ID: c4f9a2d6b831
Revises: a7e4c9d2b610, e6d2b8c4a913
Create Date: 2026-11-17 15:00:00.000000
"""

revision = "c4f9a2d6b831"
down_revision = ("a7e4c9d2b610", "e6d2b8c4a913")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
