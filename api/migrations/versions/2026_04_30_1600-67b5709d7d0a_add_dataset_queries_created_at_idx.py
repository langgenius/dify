"""add dataset_queries created_at index

Revision ID: 67b5709d7d0a
Revises: 227822d22895
Create Date: 2026-04-30 16:00:00.000000

"""
from alembic import op
import models as models

# revision identifiers, used by Alembic.
revision = '67b5709d7d0a'
down_revision = '227822d22895'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('dataset_queries', schema=None) as batch_op:
        batch_op.create_index('dataset_query_created_at_idx', ['created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('dataset_queries', schema=None) as batch_op:
        batch_op.drop_index('dataset_query_created_at_idx')
