"""add workflow tool version

Revision ID: 9e98fbaffb88
Revises: 3b18fea55204
Create Date: 2024-05-21 10:25:40.434162

"""
import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = '9e98fbaffb88'
down_revision = '3b18fea55204'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('tool_workflow_providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('version', sa.String(length=255), server_default='', nullable=False))


def downgrade():
    with op.batch_alter_table('tool_workflow_providers', schema=None) as batch_op:
        batch_op.drop_column('version')
