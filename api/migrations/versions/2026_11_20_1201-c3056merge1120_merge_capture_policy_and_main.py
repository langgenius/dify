"""Merge capture policy evidence with the existing main migration history.

Revision ID: c3056merge1120
Revises: c3051merge1117, c3056cap1120
Create Date: 2026-11-20
"""

revision = "c3056merge1120"
down_revision = ("c3051merge1117", "c3056cap1120")
branch_labels = None
depends_on = None


def upgrade():
    """Join histories without changing data or schema."""
    pass


def downgrade():
    """Separate the histories without changing data or schema."""
    pass
