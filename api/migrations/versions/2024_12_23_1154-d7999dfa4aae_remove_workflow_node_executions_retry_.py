"""remove workflow_node_executions.retry_index if exists

Revision ID: d7999dfa4aae
Revises: e1944c35e15e
Create Date: 2024-12-23 11:54:15.344543

"""
from alembic import op
import models as models
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'd7999dfa4aae'
down_revision = 'e1944c35e15e'
branch_labels = None
depends_on = None


def upgrade():
    # Check if column exists before attempting to remove it
    conn = op.get_bind()
    inspector = inspect(conn)
    has_column = 'retry_index' in [col['name'] for col in inspector.get_columns('workflow_node_executions')]
    
    if has_column:
        with op.batch_alter_table('workflow_node_executions', schema=None) as batch_op:
            batch_op.drop_column('retry_index')


def downgrade():
    # No downgrade needed as we don't want to restore the column
    pass
