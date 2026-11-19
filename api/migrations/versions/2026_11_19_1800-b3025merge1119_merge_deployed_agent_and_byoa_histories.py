"""Join the preserved deployed Agent and incoming BYOA migration histories.

Revision ID: b3025merge1119
Revises: b6b0741cf19d, c3051merge1117
Create Date: 2026-11-19

This metadata-only merge preserves every predecessor revision. It does not
change the deployment's explicit migration policy or execute pending branches.
"""

revision = "b3025merge1119"
down_revision = ("b6b0741cf19d", "c3051merge1117")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Given both predecessor histories, join their heads without schema or data changes."""
    pass


def downgrade() -> None:
    """Restore both predecessor heads without schema or data changes."""
    pass
