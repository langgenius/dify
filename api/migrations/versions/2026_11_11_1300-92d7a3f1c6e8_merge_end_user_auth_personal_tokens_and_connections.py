"""Merge EndUser authentication, personal tokens and connection reconciliation.

Revision ID: 92d7a3f1c6e8
Revises: b2e4c6d8a013, e7f1a9c4d602, 8e1a5c7b9d24
Create Date: 2026-11-11 13:00:00.000000
"""

revision = "92d7a3f1c6e8"
down_revision = ("b2e4c6d8a013", "e7f1a9c4d602", "8e1a5c7b9d24")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join all existing migration heads without changing schema or data."""


def downgrade() -> None:
    """Restore the three parent heads without changing schema or data."""
