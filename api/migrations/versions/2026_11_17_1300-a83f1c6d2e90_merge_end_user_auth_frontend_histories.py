"""Merge EndUser authentication backend and frontend migration histories.

Revision ID: a83f1c6d2e90
Revises: b6d8f2a4c901, 3b7a9d1e6c42
Create Date: 2026-11-17 13:00:00.000000
"""

revision = "a83f1c6d2e90"
down_revision = ("b6d8f2a4c901", "3b7a9d1e6c42")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both parent histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
