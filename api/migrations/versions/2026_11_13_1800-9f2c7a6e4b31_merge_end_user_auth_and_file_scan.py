"""Merge EndUser authentication and file-scanning migration histories.

Revision ID: 9f2c7a6e4b31
Revises: 7d4b1c8e6a20, 8c2f5d7a1e30
Create Date: 2026-11-13 18:00:00.000000
"""

revision = "9f2c7a6e4b31"
down_revision = ("7d4b1c8e6a20", "8c2f5d7a1e30")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both parent histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
