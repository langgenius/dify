"""Join the End User Auth and onboarding migration heads.

Revision ID: 151fcf64f8b2
Revises: a7e4c9d2b610, c17c8ae11622
Create Date: 2026-11-26 17:30:00.000000
"""

revision = "151fcf64f8b2"
down_revision = ("a7e4c9d2b610", "c17c8ae11622")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the existing revision heads without modifying schema or data."""


def downgrade() -> None:
    """Restore the parent revision heads without modifying schema or data."""
