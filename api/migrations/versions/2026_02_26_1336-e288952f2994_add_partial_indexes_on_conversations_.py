"""add partial indexes on conversations for app_id with created_at and updated_at

Revision ID: e288952f2994
Revises: fce013ca180e
Create Date: 2026-02-26 13:36:45.928922

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e288952f2994'
down_revision = 'fce013ca180e'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.create_index(
            'conversation_app_created_at_idx',
            ['app_id', sa.literal_column('created_at DESC')],
            unique=False,
            postgresql_where=sa.text('is_deleted IS false'),
        )
        batch_op.create_index(
            'conversation_app_updated_at_idx',
            ['app_id', sa.literal_column('updated_at DESC')],
            unique=False,
            postgresql_where=sa.text('is_deleted IS false'),
        )


def downgrade():
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_index('conversation_app_updated_at_idx')
        batch_op.drop_index('conversation_app_created_at_idx')
