"""Merge SaaS and Guest file ownership index histories without schema changes.

Revision ID: 9c4a7e2b1d60
Revises: 7f3d8c1a9b20, f8c2a6d4e901
Create Date: 2026-11-13 17:00:00.000000
"""

revision = "9c4a7e2b1d60"
down_revision = ("7f3d8c1a9b20", "f8c2a6d4e901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing heads without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
