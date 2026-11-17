"""Merge SaaS and EndUser authentication/Evaluation migration histories.

Revision ID: e6d2b8c4a913
Revises: c3a8e5d1f902, 3b7a9d1e6c42
Create Date: 2026-11-17 13:00:00.000000
"""

revision = "e6d2b8c4a913"
down_revision = ("c3a8e5d1f902", "3b7a9d1e6c42")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
