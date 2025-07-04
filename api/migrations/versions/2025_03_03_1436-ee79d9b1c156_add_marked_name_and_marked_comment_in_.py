"""add marked_name and marked_comment in workflows

Revision ID: ee79d9b1c156
Revises: 4413929e1ec2
Create Date: 2025-03-03 14:36:05.750346

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ee79d9b1c156'
down_revision = '5511c782ee4c'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('workflows', schema=None) as batch_op:
        batch_op.add_column(sa.Column('marked_name', sa.String(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('marked_comment', sa.String(), nullable=False, server_default=''))


def downgrade():
    with op.batch_alter_table('workflows', schema=None) as batch_op:
        batch_op.drop_column('marked_comment')
        batch_op.drop_column('marked_name')
