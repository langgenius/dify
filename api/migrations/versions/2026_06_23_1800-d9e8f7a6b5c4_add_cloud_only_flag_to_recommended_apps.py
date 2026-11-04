"""add cloud only flag to recommended apps

Revision ID: d9e8f7a6b5c4
Revises: c8f4a6b2d3e1
Create Date: 2026-06-23 18:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d9e8f7a6b5c4"
down_revision = "c8f4a6b2d3e1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_cloud_only", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.drop_column("is_cloud_only")
