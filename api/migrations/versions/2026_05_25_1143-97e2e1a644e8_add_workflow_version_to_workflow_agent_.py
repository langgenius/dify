"""add workflow_version to workflow_agent_node_bindings

Restores the stage 1 §5.3 unique key
``(tenant_id, workflow_id, workflow_version, node_id)`` so draft and published
workflow bindings can coexist at the same workflow_id once we want to track
them per workflow version. ``workflow_version`` mirrors ``workflows.version``
("draft" or a published version string).

Because the New Agent Experience feature is pre-release, this table is empty
in every environment that matters; the ``server_default='draft'`` only exists
to keep developer-local rows valid during the alter and is dropped immediately
afterward so application code must specify ``workflow_version`` explicitly.

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
                server_default='draft',
            )
        )
        batch_op.alter_column('workflow_version', server_default=None)
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
