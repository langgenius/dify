"""Merge BYOA compatibility and personal access token migration histories.

Revision ID: c3025merge1112
Revises: c3025dflt1112, b2e4c6d8a013
Create Date: 2026-11-12
"""

revision = "c3025merge1112"
down_revision = ("c3025dflt1112", "b2e4c6d8a013")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both applied histories without changing schemas or existing rows."""
    pass


def downgrade() -> None:
    """Restore the two predecessor heads without changing schemas or rows."""
    pass
