"""add agent role

Revision ID: 0b2f2c8a9d1e
Revises: 7bad07dc267d
Create Date: 2026-06-12 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0b2f2c8a9d1e"
down_revision = "7bad07dc267d"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("role", sa.String(length=255), nullable=False))


def downgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("role")
