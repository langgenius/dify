"""Join the App Builder and KnowledgeFS migration histories.

Revision ID: 998595ace7d2
Revises: 430a56d97885, 6b1d2f4e8a90
Create Date: 2026-11-27 08:30:00.000000
"""

revision = "998595ace7d2"
down_revision = ("430a56d97885", "6b1d2f4e8a90")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the branch heads after both parent upgrades have run."""


def downgrade() -> None:
    """Restore the two parent heads without changing their schema."""
