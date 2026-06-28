"""add workflow_version to workflow_agent_node_bindings

Revision ID: 97e2e1a644e8
Revises: f8b6b7e9c421
Create Date: 2026-05-25 11:43:37.611300

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '97e2e1a644e8'
down_revision = 'f8b6b7e9c421'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('workflow_agent_node_bindings', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'workflow_version',
                sa.String(length=255),
                nullable=False,
            )
        )
        batch_op.drop_constraint(
            batch_op.f('workflow_agent_node_binding_node_unique'), type_='unique'
        )
        batch_op.create_unique_constraint(
            'workflow_agent_node_binding_node_version_unique',
            ['tenant_id', 'workflow_id', 'workflow_version', 'node_id'],
        )
        batch_op.create_index(
            'workflow_agent_node_binding_workflow_version_idx',
            ['tenant_id', 'workflow_id', 'workflow_version'],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table('workflow_agent_node_bindings', schema=None) as batch_op:
        batch_op.drop_index('workflow_agent_node_binding_workflow_version_idx')
        batch_op.drop_constraint(
            'workflow_agent_node_binding_node_version_unique', type_='unique'
        )
        batch_op.create_unique_constraint(
            batch_op.f('workflow_agent_node_binding_node_unique'),
            ['tenant_id', 'workflow_id', 'node_id'],
            postgresql_nulls_not_distinct=False,
        )
        batch_op.drop_column('workflow_version')
