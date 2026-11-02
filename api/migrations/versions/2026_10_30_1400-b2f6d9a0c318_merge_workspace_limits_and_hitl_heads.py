"""merge workspace limits and HITL heads

Revision ID: b2f6d9a0c318
Revises: c4e8a9f1d270, 0cc3158b50b0
Create Date: 2026-10-30 14:00:00.000000

"""

revision = "b2f6d9a0c318"
down_revision = ("c4e8a9f1d270", "0cc3158b50b0")
branch_labels = None
depends_on = None


def upgrade():
    """Require both parents applied; preserve their schema while Alembic joins the heads."""
    pass


def downgrade():
    """Require the merge revision applied; preserve the schema while restoring parent heads."""
    pass
