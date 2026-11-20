"""Join the deployment credential key and main migration histories.

Revision ID: d4bb926034c7
Revises: a84d72e9c61f, f8b6e2c4a901
"""

revision = "d4bb926034c7"
down_revision = ("a84d72e9c61f", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Stamp the join after both schema branches have been applied."""


def downgrade() -> None:
    """Unstamp the join without changing either parent schema."""
