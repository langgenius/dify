"""Merge deployment credential and AppDeploy HITL migration histories.

Revision ID: c79e3a5d210b
Revises: b48f01ac7123, a84d72e9c61f
"""

revision = "c79e3a5d210b"
down_revision = ("b48f01ac7123", "a84d72e9c61f")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Require both parent schemas; preserve their independent data and keys."""


def downgrade() -> None:
    """Return to both parent revisions without changing data or external keys."""
