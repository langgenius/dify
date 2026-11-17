"""Merge both EndUser authentication migration histories.

Revision ID: a7e4c9d2b610
Revises: b6d8f2a4c901, 3b7a9d1e6c42
Create Date: 2026-11-17 14:00:00.000000
"""

revision = "a7e4c9d2b610"
down_revision = ("b6d8f2a4c901", "3b7a9d1e6c42")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
