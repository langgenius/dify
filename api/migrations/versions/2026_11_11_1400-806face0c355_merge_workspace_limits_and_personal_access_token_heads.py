"""merge workspace limits and personal access token heads

Revision ID: 806face0c355
Revises: e6c8a4d927b0, b2e4c6d8a013
Create Date: 2026-11-11 14:00:00.000000

"""

revision = "806face0c355"
down_revision = ("e6c8a4d927b0", "b2e4c6d8a013")
branch_labels = None
depends_on = None


def upgrade():
    """Require both parents applied; preserve their schema while Alembic joins the heads."""
    pass


def downgrade():
    """Require the merge revision applied; preserve the schema while restoring parent heads."""
    pass
