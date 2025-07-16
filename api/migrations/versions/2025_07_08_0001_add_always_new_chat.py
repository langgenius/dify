"""add always_new_chat boolean field to apps and sites (default true)

Revision ID: 0001_add_always_new_chat
Revises:
Create Date: 2025-07-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd57ba9ebb254'
down_revision = '1c9ba48be8e4'
branch_labels = None
depends_on = None

def upgrade():
    for table in ('apps', 'sites'):
        op.add_column(table, sa.Column('always_new_chat', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade():
    for table in ('apps', 'sites'):
        op.drop_column(table, 'always_new_chat')
