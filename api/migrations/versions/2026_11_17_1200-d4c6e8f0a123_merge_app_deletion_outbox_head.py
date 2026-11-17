"""Join App deletion outbox migration with the current main history.

Revision ID: d4c6e8f0a123
Revises: c9a8d7e6f501, f8b6e2c4a901
Create Date: 2026-11-17 12:00:00.000000
"""

revision = "d4c6e8f0a123"
down_revision = ("c9a8d7e6f501", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
