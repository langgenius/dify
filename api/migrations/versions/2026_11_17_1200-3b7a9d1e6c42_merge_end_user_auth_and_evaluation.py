"""Merge EndUser authentication and Evaluation migration histories.

Revision ID: 3b7a9d1e6c42
Revises: 92d7a3f1c6e8, f8b6e2c4a901
Create Date: 2026-11-17 12:00:00.000000
"""

revision = "3b7a9d1e6c42"
down_revision = ("92d7a3f1c6e8", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both parent histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
