"""add description field to dataset_metadatas

Revision ID: c11a4d15aa26
Revises: d57accd375ae
Create Date: 2025-12-15 14:19:36.837747

"""
from alembic import op
import models as models
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'c11a4d15aa26'
down_revision = 'd57accd375ae'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('dataset_metadatas', schema=None) as batch_op:
        batch_op.add_column(sa.Column('description', sa.String(length=255), nullable=True, default=None))



def downgrade():
    with op.batch_alter_table('dataset_metadatas', schema=None) as batch_op:
        batch_op.drop_column('description')
