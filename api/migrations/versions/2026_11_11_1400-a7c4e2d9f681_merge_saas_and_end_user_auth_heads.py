"""Merge SaaS and EndUser authentication histories without schema changes.

Revision ID: a7c4e2d9f681
Revises: d9a72f03b8e1, 92d7a3f1c6e8
Create Date: 2026-11-11 14:00:00.000000
"""

revision = "a7c4e2d9f681"
down_revision = ("d9a72f03b8e1", "92d7a3f1c6e8")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing heads without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
