"""message parent id

Revision ID: 028767889ee3
Revises: 2dbe42621d96
Create Date: 2024-08-23 03:04:36.148579

"""
import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = '028767889ee3'
down_revision = '2dbe42621d96'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('parent_message_id', models.types.StringUUID(), nullable=True))


def downgrade():
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_column('parent_message_id')

