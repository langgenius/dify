"""Join App capture evidence with all existing dev migration branches.

Revision ID: c3056dev1120
Revises: b3025merge1119, c3056merge1120
Create Date: 2026-11-20
"""

revision = "c3056dev1120"
down_revision = ("b3025merge1119", "c3056merge1120")
branch_labels = None
depends_on = None


def upgrade():
    """Join the preserved histories without schema or data changes."""
    pass


def downgrade():
    """Separate the preserved histories without schema or data changes."""
    pass
