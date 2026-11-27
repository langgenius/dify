"""Join BYOA and upstream file-scanning migration histories.

Revision ID: c3046merge1115
Revises: c3025merge1112, 8c2f5d7a1e30
Create Date: 2026-11-15
"""

revision = "c3046merge1115"
down_revision = ("c3025merge1112", "8c2f5d7a1e30")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the two applied branches without changing schema or existing data."""
    pass


def downgrade() -> None:
    """Restore both predecessor heads without reverting either branch's data."""
    pass
