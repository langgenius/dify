"""merge workspace limits and evaluation heads

Revision ID: d73abf812e90
Revises: 806face0c355, f8b6e2c4a901
Create Date: 2026-11-17 12:00:00.000000

"""

revision = "d73abf812e90"
down_revision = ("806face0c355", "f8b6e2c4a901")
branch_labels = None
depends_on = None


def upgrade():
    """Require both parents applied; preserve their schema while Alembic joins the heads."""
    pass


def downgrade():
    """Require the merge revision applied; preserve the schema while restoring parent heads."""
    pass
