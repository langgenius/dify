"""Store the immediate Workflow Tool caller on node executions.

Revision ID: a8c3e7f4b912
Revises: e7b2a9c4d601
Create Date: 2026-09-23 22:00:00

Existing source categories have no Workflow Tool caller and remain null.
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "a8c3e7f4b912"
down_revision = "e7b2a9c4d601"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_node_executions") as batch_op:
        batch_op.add_column(sa.Column("triggered_from_workflow_id", StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("triggered_from_node_execution_id", sa.String(255), nullable=True))


def downgrade():
    with op.batch_alter_table("workflow_node_executions") as batch_op:
        batch_op.drop_column("triggered_from_node_execution_id")
        batch_op.drop_column("triggered_from_workflow_id")
