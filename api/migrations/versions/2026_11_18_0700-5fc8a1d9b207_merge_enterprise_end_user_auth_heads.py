"""Join the deployed Enterprise revision and the upstream EndUser auth head.

Revision ID: 5fc8a1d9b207
Revises: a83f1c6d2e90, a7e4c9d2b610
Create Date: 2026-11-18 07:00:00.000000

Both parents join the same schema history. Keep both revision IDs so deployments
stamped at either parent can upgrade without replaying schema operations.
"""

revision = "5fc8a1d9b207"
down_revision = ("a83f1c6d2e90", "a7e4c9d2b610")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Converge both revision histories without changing schema or data."""


def downgrade() -> None:
    """Restore the two parent heads without changing schema or data."""
