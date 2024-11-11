"""add workflow tool label and tool bindings idx

Revision ID: 03f98355ba0e
Revises: 9e98fbaffb88
Create Date: 2024-05-25 07:17:00.539125

"""
import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = '03f98355ba0e'
down_revision = '9e98fbaffb88'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('tool_label_bindings', schema=None) as batch_op:
        batch_op.create_unique_constraint('unique_tool_label_bind', ['tool_id', 'label_name'])

    with op.batch_alter_table('tool_workflow_providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('label', sa.String(length=255), server_default='', nullable=False))


def downgrade():
    with op.batch_alter_table('tool_workflow_providers', schema=None) as batch_op:
        batch_op.drop_column('label')

    with op.batch_alter_table('tool_label_bindings', schema=None) as batch_op:
        batch_op.drop_constraint('unique_tool_label_bind', type_='unique')
