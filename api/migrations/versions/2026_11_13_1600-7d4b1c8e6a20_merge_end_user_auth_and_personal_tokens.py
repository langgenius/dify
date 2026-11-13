"""Merge EndUser file ownership indexes and personal access token histories.

Revision ID: 7d4b1c8e6a20
Revises: f8c2a6d4e901, b2e4c6d8a013
Create Date: 2026-11-13 16:00:00.000000
"""

revision = "7d4b1c8e6a20"
down_revision = ("f8c2a6d4e901", "b2e4c6d8a013")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both migration histories without changing schema or data."""


def downgrade() -> None:
    """Restore both migration heads without changing schema or data."""
