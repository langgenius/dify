"""add max active requests to tenants

Revision ID: a7f3c9d2e1b4
Revises: a4f2d8c9b731
Create Date: 2026-06-16 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "a7f3c9d2e1b4"
down_revision = "a4f2d8c9b731"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tenants", schema=None) as batch_op:
        batch_op.add_column(sa.Column("max_active_requests", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("tenants", schema=None) as batch_op:
        batch_op.drop_column("max_active_requests")
