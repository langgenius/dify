"""add project fields to datasets

Revision ID: 2026_03_15_1610
Revises: fecff1c3da27
Create Date: 2026-03-15 16:10:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2026_03_15_1610'
down_revision = 'fecff1c3da27'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('space_type', sa.String(length=20), nullable=False, server_default=sa.text("'personal'")))
        batch_op.create_index('idx_datasets_project_id', ['project_id'], unique=False)
        batch_op.create_index('idx_datasets_space_type', ['space_type'], unique=False)


def downgrade():
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.drop_index('idx_datasets_space_type')
        batch_op.drop_index('idx_datasets_project_id')
        batch_op.drop_column('space_type')
        batch_op.drop_column('project_id')
