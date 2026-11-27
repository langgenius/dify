"""Merge EndUser authentication and IM synchronization histories.

Revision ID: 8e1a5c7b9d24
Revises: c64f2b7a913e, 6b7e2a9c4d10
Create Date: 2026-11-11 12:00:00.000000
"""

revision = "8e1a5c7b9d24"
down_revision = ("c64f2b7a913e", "6b7e2a9c4d10")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both migration histories without changing schema or data."""


def downgrade() -> None:
    """Restore both migration heads without changing schema or data."""
