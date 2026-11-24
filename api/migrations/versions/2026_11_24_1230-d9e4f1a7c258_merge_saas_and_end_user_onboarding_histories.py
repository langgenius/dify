"""Merge SaaS and End User onboarding migration histories.

Revision ID: d9e4f1a7c258
Revises: c4f9a2d6b831, c17c8ae11622
Create Date: 2026-11-24 12:30:00.000000
"""

revision = "d9e4f1a7c258"
down_revision = ("c4f9a2d6b831", "c17c8ae11622")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both existing histories without changing schema or data."""


def downgrade() -> None:
    """Restore both parent heads without changing schema or data."""
