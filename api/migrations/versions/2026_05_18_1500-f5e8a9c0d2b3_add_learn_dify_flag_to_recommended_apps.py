"""add learn dify flag to recommended apps

Revision ID: f5e8a9c0d2b3
Revises: a4f2d8c9b731
Create Date: 2026-05-18 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f5e8a9c0d2b3"
down_revision = "a4f2d8c9b731"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_learn_dify", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.drop_column("is_learn_dify")
