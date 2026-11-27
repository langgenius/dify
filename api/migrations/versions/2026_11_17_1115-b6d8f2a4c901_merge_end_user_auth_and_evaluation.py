"""Merge EndUser authentication and Evaluation migration histories.

Revision ID: b6d8f2a4c901
Revises: 9f2c7a6e4b31, f8b6e2c4a901
Create Date: 2026-11-17 11:15:00.000000
"""

revision = "b6d8f2a4c901"
down_revision = ("9f2c7a6e4b31", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both parent histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
