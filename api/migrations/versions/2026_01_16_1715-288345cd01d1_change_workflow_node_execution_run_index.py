"""change workflow node execution workflow_run index

Revision ID: 288345cd01d1
Revises: 3334862ee907
Create Date: 2026-01-16 17:15:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "288345cd01d1"
down_revision = "3334862ee907"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_node_executions", schema=None) as batch_op:
        batch_op.drop_index("workflow_node_execution_workflow_run_idx")
        batch_op.create_index(
            "workflow_node_execution_workflow_run_id_idx",
            ["workflow_run_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("workflow_node_executions", schema=None) as batch_op:
        batch_op.drop_index("workflow_node_execution_workflow_run_id_idx")
        batch_op.create_index(
            "workflow_node_execution_workflow_run_idx",
            ["tenant_id", "app_id", "workflow_id", "triggered_from", "workflow_run_id"],
            unique=False,
        )
