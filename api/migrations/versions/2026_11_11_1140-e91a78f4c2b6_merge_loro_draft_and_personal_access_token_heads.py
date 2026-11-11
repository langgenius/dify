"""Merge Loro draft and personal access token migration heads.

Revision ID: e91a78f4c2b6
Revises: b2e4c6d8a013, c6d2d8bc881f
Create Date: 2026-11-11 11:40:00
"""

revision = "e91a78f4c2b6"
down_revision = ("b2e4c6d8a013", "c6d2d8bc881f")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join both applied parent revisions without changing schema or data."""
    pass


def downgrade() -> None:
    """Restore both parent heads without changing their schema or data."""
    pass
