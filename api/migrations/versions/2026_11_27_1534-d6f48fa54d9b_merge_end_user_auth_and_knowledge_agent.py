"""Join the End User Auth and Knowledge Agent migration heads.

Revision ID: d6f48fa54d9b
Revises: 151fcf64f8b2, 6b1d2f4e8a90
Create Date: 2026-11-27 15:34:00.000000
"""

revision = "d6f48fa54d9b"
down_revision = ("151fcf64f8b2", "6b1d2f4e8a90")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the existing revision heads without modifying schema or data."""


def downgrade() -> None:
    """Restore the parent revision heads without modifying schema or data."""
