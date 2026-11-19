"""Merge workflow execution and current HITL migration heads.

Revision ID: 7ec4d91a6b02
Revises: d9a7b5c3e102, 0cc3158b50b0
Create Date: 2026-10-31 12:00:00
"""

revision = "7ec4d91a6b02"
down_revision = ("d9a7b5c3e102", "0cc3158b50b0")
branch_labels = None
depends_on = None


def upgrade():
    """Join both applied parent histories without changing the schema."""


def downgrade():
    """Restore the two parent heads without changing the schema."""
