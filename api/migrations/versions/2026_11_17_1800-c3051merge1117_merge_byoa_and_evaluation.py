"""Join BYOA and upstream Evaluation migration histories.

Revision ID: c3051merge1117
Revises: c3046merge1115, f8b6e2c4a901
Create Date: 2026-11-17
"""

revision = "c3051merge1117"
down_revision = ("c3046merge1115", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the applied histories without changing schema or existing data."""
    pass


def downgrade() -> None:
    """Restore both predecessor heads without reverting either branch's data."""
    pass
