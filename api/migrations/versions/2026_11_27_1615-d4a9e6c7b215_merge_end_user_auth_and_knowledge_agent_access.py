"""Merge the End User authentication and Knowledge Agent access revisions.

Revision ID: d4a9e6c7b215
Revises: c17c8ae11622, 6b1d2f4e8a90
Create Date: 2026-11-27 16:15:00.000000
"""

revision = "d4a9e6c7b215"
down_revision = ("c17c8ae11622", "6b1d2f4e8a90")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the two completed schema histories without altering schema or data."""


def downgrade() -> None:
    """Restore the two parent stamps without altering schema or data."""
