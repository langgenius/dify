"""add show_reasoning to sites

Revision ID: a1b2c3d4e5f6
Revises: d98acf217d43
Create Date: 2025-10-17 00:00:00.000000

"""
from alembic import op
import models as models
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'd98acf217d43'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('show_reasoning', sa.Boolean(), nullable=False, server_default=sa.text('true')))


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_column('show_reasoning')

