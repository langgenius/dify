"""merge workspace limits and trace pipeline heads

Revision ID: e6c8a4d927b0
Revises: b2f6d9a0c318, 53c10126d551
Create Date: 2026-11-02 14:00:00.000000

"""

revision = "e6c8a4d927b0"
down_revision = ("b2f6d9a0c318", "53c10126d551")
branch_labels = None
depends_on = None


def upgrade():
    """Require both parents applied; preserve their schema while Alembic joins the heads."""
    pass


def downgrade():
    """Require the merge revision applied; preserve the schema while restoring parent heads."""
    pass
