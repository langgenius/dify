"""Persist workflow task ownership and cancellation intent.

Revision ID: c6f4a90d8b31
Revises: a8c9e2f1b704
Create Date: 2026-10-10 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "c6f4a90d8b31"
down_revision = "a8c9e2f1b704"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_runs") as batch_op:
        batch_op.add_column(sa.Column("task_id", StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("stop_requested_at", sa.DateTime(), nullable=True))
        batch_op.create_index("workflow_run_task_id_idx", ["task_id"])


def downgrade():
    with op.batch_alter_table("workflow_runs") as batch_op:
        batch_op.drop_index("workflow_run_task_id_idx")
        batch_op.drop_column("stop_requested_at")
        batch_op.drop_column("task_id")
